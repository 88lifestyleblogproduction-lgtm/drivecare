import { getAll, putMany, removeMany } from './db';
import { classify } from './classify';
import { fetchEvents, type GEvent } from './google';
import { loadSettings, saveSettings } from './settings';
import { normalizeKey, titleKey } from './address';
import { zonedToIso } from './time';
import { errMsg, nowIso } from './util';
import type { Appointment, CategoryDef, SavedLocation, Trip } from './types';

export interface SyncSummary {
  scanned: number;
  added: number;
  updated: number;
  cancelled: number;
  removed: number;
}

/** Finds the saved place for a calendar location string (or, when no location text, the title). */
export function resolveLocationId(locationRaw: string, summary: string, locations: SavedLocation[]): string | null {
  const key = normalizeKey(locationRaw);
  if (key) {
    const hit = locations.find((l) => l.matchKeys.includes(key));
    return hit ? hit.id : null;
  }
  if (summary.trim()) {
    const tk = titleKey(summary);
    const hit = locations.find((l) => l.matchKeys.includes(tk));
    return hit ? hit.id : null;
  }
  return null;
}

function eventTimes(ev: GEvent): { start: string; end: string; allDay: boolean } | null {
  if (ev.start?.dateTime) {
    const start = new Date(ev.start.dateTime).toISOString();
    const end = ev.end?.dateTime ? new Date(ev.end.dateTime).toISOString() : start;
    return { start, end, allDay: false };
  }
  if (ev.start?.date) {
    return { start: zonedToIso(ev.start.date, '00:00'), end: zonedToIso(ev.end?.date ?? ev.start.date, '00:00'), allDay: true };
  }
  return null;
}

export async function syncCalendars(): Promise<SyncSummary> {
  const settings = await loadSettings();
  if (!settings.selectedCalendars.length) throw new Error('Choose at least one calendar in Settings → Google Calendar.');
  const summary: SyncSummary = { scanned: 0, added: 0, updated: 0, cancelled: 0, removed: 0 };
  const now = Date.now();
  const timeMin = new Date(now - settings.syncPastDays * 864e5).toISOString();
  const timeMax = new Date(now + settings.syncFutureDays * 864e5).toISOString();
  const stamp = nowIso();

  try {
    const [existing, locations, trips] = await Promise.all([
      getAll<Appointment>('appointments'),
      getAll<SavedLocation>('locations'),
      getAll<Trip>('trips'),
    ]);
    const byId = new Map(existing.map((a) => [a.id, a]));
    const linked = new Set<string>();
    for (const t of trips) {
      if (t.toAppointmentId) linked.add(t.toAppointmentId);
      if (t.fromAppointmentId) linked.add(t.fromAppointmentId);
    }
    const toPut: Appointment[] = [];
    const toDelete: string[] = [];

    for (const cal of settings.selectedCalendars) {
      const events = await fetchEvents(cal.id, timeMin, timeMax);
      const seen = new Set<string>();
      for (const ev of events) {
        summary.scanned++;
        const id = `${cal.id}|${ev.id}`;
        seen.add(id);
        const prev = byId.get(id);

        if (ev.status === 'cancelled') {
          if (prev && prev.status !== 'cancelled') {
            toPut.push({ ...prev, status: 'cancelled', statusNote: 'Cancelled in Google Calendar', lastSynced: stamp, updatedAt: stamp });
            summary.cancelled++;
          }
          continue;
        }

        const title = ev.summary ?? '';
        let cls = classify(title, settings.categories);
        const timed = !!ev.start?.dateTime;
        // Import mode: every timed event (default), events with a location, or keyword matches only.
        // All-day events (birthdays, holidays, reminders) are only imported when a keyword matches.
        if (!cls && timed && (settings.importMode === 'all' || (settings.importMode === 'location' && (ev.location ?? '').trim()))) {
          cls = { categoryId: 'general', keyword: '' };
        }
        if (!prev && !cls) continue;
        if (prev && !cls && !prev.categoryOverride) {
          if (linked.has(id)) {
            toPut.push({ ...prev, summary: title, status: 'removed', statusNote: 'No longer matches your import settings', lastSynced: stamp, updatedAt: stamp });
          } else {
            toDelete.push(id);
          }
          summary.removed++;
          continue;
        }
        const times = eventTimes(ev);
        if (!times) continue;

        const locationRaw = (ev.location ?? '').trim();
        let locationId = prev?.locationId ?? null;
        if (prev && !prev.locationManual && prev.locationRaw !== locationRaw) locationId = null;
        if (!locationId) locationId = resolveLocationId(locationRaw, title, locations);

        const categoryId = prev?.categoryOverride ? prev.categoryId : cls ? cls.categoryId : prev!.categoryId;
        const status = ev.status === 'tentative' ? 'tentative' : 'confirmed';
        const appt: Appointment = {
          id,
          source: 'google',
          calendarId: cal.id,
          calendarName: cal.name,
          eventId: ev.id,
          summary: title,
          locationRaw,
          start: times.start,
          end: times.end,
          allDay: times.allDay,
          status,
          statusNote: '',
          googleUpdated: ev.updated ?? '',
          categoryId,
          categoryOverride: prev?.categoryOverride ?? false,
          matchedKeyword: cls?.keyword ?? prev?.matchedKeyword ?? '',
          locationId,
          locationManual: prev?.locationManual ?? false,
          excluded: prev?.excluded ?? false,
          lastSynced: stamp,
          createdAt: prev?.createdAt ?? stamp,
          updatedAt: stamp,
        };
        if (!prev) summary.added++;
        else if (
          prev.start !== appt.start ||
          prev.end !== appt.end ||
          prev.summary !== appt.summary ||
          prev.locationRaw !== appt.locationRaw ||
          prev.status !== appt.status
        )
          summary.updated++;
        toPut.push(appt);
      }

      // Events that disappeared from the calendar inside the sync window
      for (const a of existing) {
        if (a.source !== 'google' || a.calendarId !== cal.id || seen.has(a.id)) continue;
        if (a.start < timeMin || a.start > timeMax) continue;
        if (a.status === 'cancelled' || a.status === 'removed') continue;
        toPut.push({ ...a, status: 'removed', statusNote: 'Deleted from Google Calendar', lastSynced: stamp, updatedAt: stamp });
        summary.removed++;
      }
    }

    await putMany('appointments', toPut);
    await removeMany('appointments', toDelete);
    const text = `${summary.added} new, ${summary.updated} updated, ${summary.cancelled} cancelled, ${summary.removed} removed`;
    await saveSettings({ lastSync: stamp, lastSyncError: null, lastSyncSummary: text, googleConnected: true });
    return summary;
  } catch (e) {
    await saveSettings({ lastSyncError: errMsg(e) });
    throw e;
  }
}

/** After the user confirms a clinic, link every other appointment with the same location text. */
export async function applyLocationToMatching(loc: SavedLocation): Promise<number> {
  const appts = await getAll<Appointment>('appointments');
  const stamp = nowIso();
  const changed: Appointment[] = [];
  for (const a of appts) {
    if (a.locationId || a.locationManual) continue;
    const key = normalizeKey(a.locationRaw);
    const match = key ? loc.matchKeys.includes(key) : loc.matchKeys.includes(titleKey(a.summary));
    if (match) changed.push({ ...a, locationId: loc.id, updatedAt: stamp });
  }
  await putMany('appointments', changed);
  return changed.length;
}

/**
 * Re-applies the current keyword rules to imported appointments whose type you have not chosen
 * yourself (e.g. after keywords or their priority change). No network needed.
 */
export async function reclassifyStored(categories: CategoryDef[]): Promise<number> {
  const appts = await getAll<Appointment>('appointments');
  const stamp = nowIso();
  const changed: Appointment[] = [];
  for (const a of appts) {
    if (a.source !== 'google' || a.categoryOverride) continue;
    const cls = classify(a.summary, categories);
    if (cls && (cls.categoryId !== a.categoryId || cls.keyword !== a.matchedKeyword)) {
      changed.push({ ...a, categoryId: cls.categoryId, matchedKeyword: cls.keyword, updatedAt: stamp });
    }
  }
  await putMany('appointments', changed);
  return changed.length;
}
