import { useEffect, useState } from 'react';
import { WorkCard } from '../components/WorkSettings';
import { NumberInput } from '../components/ui';
import { Badge, Banner, Button, Field, List, Row, Section, Select, Sheet, Spinner, TextInput, Toggle, useToast } from '../components/ui';
import { useData } from '../lib/data';
import { DEFAULT_CATEGORIES, effectiveClientId, saveSettings } from '../lib/settings';
import { getToken, listCalendars, redirectUri, revokeGoogle, startGoogleAuth, tokenMinutesLeft, AuthRequiredError } from '../lib/google';
import { useCalendarSync } from '../lib/useSync';
import { clearAll, clearStore, getAll, removeMany } from '../lib/db';
import { createBackup, restoreBackup } from '../lib/backup';
import { saveFile } from '../lib/files';
import { fmtDateTime, todayKey } from '../lib/time';
import type { Appointment, CategoryDef } from '../lib/types';
import { errMsg, uid } from '../lib/util';

export default function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings" closeLabel="Done">
      <GoogleSection />
      <AppSection />
      <Section title="Work">
        <WorkCard />
      </Section>
      <KeywordSection />
      <RoutingSection />
      <TripSection />
      <DataSection onClose={onClose} />
      <AboutSection />
    </Sheet>
  );
}

function GoogleSection() {
  const { settings } = useData();
  const toast = useToast();
  const { sync, syncing } = useCalendarSync();
  const [clientId, setClientId] = useState(settings.googleClientId);
  const [loadingCals, setLoadingCals] = useState(false);
  const token = getToken();
  const envId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
  const cid = effectiveClientId(settings);

  useEffect(() => setClientId(settings.googleClientId), [settings.googleClientId]);

  async function saveId() {
    const v = clientId.trim();
    if (v && !/\.apps\.googleusercontent\.com$/.test(v)) {
      toast('That does not look like a Google OAuth Client ID (…apps.googleusercontent.com).', 'error');
      return;
    }
    await saveSettings({ googleClientId: v });
    toast('Client ID saved');
  }

  async function loadCalendars() {
    setLoadingCals(true);
    try {
      const cals = await listCalendars();
      await saveSettings({
        availableCalendars: cals.map((c) => ({ id: c.id, name: c.name })),
        googleConnected: true,
        selectedCalendars: settings.selectedCalendars.length ? settings.selectedCalendars : cals.filter((c) => c.primary).map((c) => ({ id: c.id, name: c.name })),
      });
    } catch (e) {
      if (e instanceof AuthRequiredError) startGoogleAuth(cid, 'connect');
      else toast(errMsg(e), 'error');
    } finally {
      setLoadingCals(false);
    }
  }

  async function toggleCal(id: string, name: string, on: boolean) {
    const next = on ? [...settings.selectedCalendars.filter((c) => c.id !== id), { id, name }] : settings.selectedCalendars.filter((c) => c.id !== id);
    await saveSettings({ selectedCalendars: next });
  }

  async function disconnect() {
    if (!confirm('Disconnect Google Calendar? DriveCare will stop reading your calendar.')) return;
    const removeAppts = confirm('Also delete the appointments imported from Google?\n\nOK = delete them. Cancel = keep them.\n(Trips, clinics and manual appointments are always kept.)');
    await revokeGoogle();
    if (removeAppts) {
      const appts = await getAll<Appointment>('appointments');
      await removeMany(
        'appointments',
        appts.filter((a) => a.source === 'google').map((a) => a.id)
      );
    }
    await saveSettings({ googleConnected: false, availableCalendars: [], selectedCalendars: [], lastSync: null, lastSyncError: null, lastSyncSummary: '' });
    toast('Google Calendar disconnected');
  }

  return (
    <Section
      title="Google Calendar"
      footer={
        <>
          Read-only access (calendar.readonly). Only events whose titles match treatment keywords are stored, with just their title, time, location and status. The sign-in token stays in memory for this
          session (about 1 hour) and is never saved or included in backups.
        </>
      }
    >
      <List>
        <Field
          label="OAuth Client ID"
          hint={envId && !settings.googleClientId ? 'Using the Client ID built into this deployment.' : 'From Google Cloud Console → APIs & Services → Credentials (Web application). Not a secret.'}
        >
          <TextInput value={clientId} onChange={setClientId} placeholder={envId || '1234-abc.apps.googleusercontent.com'} />
        </Field>
        <div className="px-4 pb-3">
          <Button small variant="secondary" onClick={() => void saveId()} disabled={clientId.trim() === settings.googleClientId}>
            Save Client ID
          </Button>
        </div>
        <Row title="Authorised redirect URI" subtitle={<span className="font-mono text-[12px] break-all select-all">{redirectUri()}</span>} />
        <Row
          title="Status"
          detail={
            token ? (
              <Badge tone="green">Signed in · {tokenMinutesLeft()} min left</Badge>
            ) : settings.googleConnected ? (
              <Badge tone="orange">Connected · sign-in needed to sync</Badge>
            ) : (
              <Badge>Not connected</Badge>
            )
          }
        />
      </List>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button small onClick={() => (cid ? startGoogleAuth(cid, 'connect') : toast('Save your Client ID first.', 'error'))}>
          {settings.googleConnected ? 'Reconnect' : 'Connect Google Calendar'}
        </Button>
        {token && (
          <Button small variant="secondary" onClick={() => void loadCalendars()} disabled={loadingCals}>
            {loadingCals ? <Spinner size={14} /> : null} Refresh calendar list
          </Button>
        )}
        {settings.googleConnected && (
          <Button small variant="tinted" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <Spinner size={14} /> : null} Sync now
          </Button>
        )}
      </div>

      {settings.availableCalendars.length > 0 && (
        <List className="mt-3">
          <div className="px-4 pt-2.5 text-[13px] font-medium text-muted">Calendars to read</div>
          {settings.availableCalendars.map((c) => (
            <Toggle key={c.id} checked={settings.selectedCalendars.some((s) => s.id === c.id)} onChange={(v) => void toggleCal(c.id, c.name, v)} label={c.name} />
          ))}
        </List>
      )}

      {settings.googleConnected && (
        <List className="mt-3">
          <Field label="Import past appointments (days)">
            <Select
              value={String(settings.syncPastDays)}
              onChange={(v) => void saveSettings({ syncPastDays: Number(v) })}
              options={[30, 60, 120, 180, 365, 730].map((d) => ({ value: String(d), label: `${d} days` }))}
            />
          </Field>
          <Field label="Import future appointments (days)">
            <Select value={String(settings.syncFutureDays)} onChange={(v) => void saveSettings({ syncFutureDays: Number(v) })} options={[14, 30, 60, 90, 180].map((d) => ({ value: String(d), label: `${d} days` }))} />
          </Field>
          <Row
            title="Last sync"
            subtitle={settings.lastSyncError ? <span className="text-bad">{settings.lastSyncError}</span> : settings.lastSyncSummary || undefined}
            detail={settings.lastSync ? fmtDateTime(settings.lastSync) : 'Never'}
          />
          <Row title={<span className="text-bad">Disconnect Google Calendar</span>} onClick={() => void disconnect()} chevron={false} />
        </List>
      )}
    </Section>
  );
}

function AppSection() {
  const { settings } = useData();
  const toast = useToast();
  const [tab, setTab] = useState(settings.tabLabel);
  const [title, setTitle] = useState(settings.reportTitle);
  const [rate, setRate] = useState(settings.reimburseRate != null ? String(settings.reimburseRate) : '');
  useEffect(() => {
    setTab(settings.tabLabel);
    setTitle(settings.reportTitle);
    setRate(settings.reimburseRate != null ? String(settings.reimburseRate) : '');
  }, [settings.tabLabel, settings.reportTitle, settings.reimburseRate]);

  async function save() {
    const r = rate.trim() ? Number(rate) : null;
    if (r != null && (!Number.isFinite(r) || r < 0 || r > 5)) return toast('Enter a rate in dollars per km, e.g. 0.70', 'error');
    await saveSettings({ tabLabel: tab.trim() || 'Schedule', reportTitle: title.trim() || 'Travel & Mileage Report', reimburseRate: r, tabLabelCustom: true, reportTitleCustom: true });
    toast('Saved');
  }

  function preset(kind: 'treatment' | 'business') {
    if (kind === 'treatment') {
      setTab('Treatments');
      setTitle('Treatment Travel Report');
    } else {
      setTab('Visits');
      setTitle('Business Mileage Report');
    }
  }

  return (
    <Section
      title="App & reports"
      footer="For work mileage (e.g. sales visits): use the Business preset, enter your employer's reimbursement rate, and turn on importing other events with a location. Ask your employer which rate applies; DriveCare does not decide eligibility."
    >
      <List>
        <div className="flex gap-2 px-4 py-3">
          <Button small variant="secondary" onClick={() => preset('treatment')}>
            Treatment preset
          </Button>
          <Button small variant="secondary" onClick={() => preset('business')}>
            Business preset
          </Button>
        </div>
        <Field label="Name of the appointments tab">
          <TextInput value={tab} onChange={setTab} placeholder="Treatments" />
        </Field>
        <Field label="Report title">
          <TextInput value={title} onChange={setTitle} placeholder="Treatment Travel Report" />
        </Field>
        <Field label="Mileage reimbursement rate (optional)" hint="Dollars per km. Leave blank if not needed. Reports will show km × rate.">
          <NumberInput value={rate} onChange={setRate} placeholder="e.g. 0.70" suffix="$/km" />
        </Field>
        <div className="px-4 pb-3">
          <Button small onClick={() => void save()}>
            Save
          </Button>
        </div>
        <Toggle
          checked={settings.importAllWithLocation}
          onChange={(v) => void saveSettings({ importAllWithLocation: v })}
          label="Also import other events that have a location"
          hint="Off: only events matching the keywords below. On: client visits, meetings etc. with an address are imported as “Other appointment / visit”. Sync again after changing."
        />
      </List>
    </Section>
  );
}

function KeywordSection() {
  const { settings } = useData();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(settings.categories.map((c) => [c.id, c.keywords.join(', ')])));
    setLabels(Object.fromEntries(settings.categories.map((c) => [c.id, c.label])));
  }, [settings.categories]);

  async function commit(c: CategoryDef) {
    const keywords = (drafts[c.id] ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const label = (labels[c.id] ?? c.label).trim() || c.label;
    if (keywords.join('|') === c.keywords.join('|') && label === c.label) return;
    await saveSettings({ categories: settings.categories.map((x) => (x.id === c.id ? { ...x, keywords, label } : x)) });
    toast('Keywords saved — sync again to re-check events');
  }

  async function addCategory() {
    const name = prompt('Name for the new appointment type (e.g. Chiropractic, Sales visit)');
    if (!name?.trim()) return;
    const cat: CategoryDef = { id: `custom-${uid().slice(0, 8)}`, label: name.trim(), keywords: [name.trim().toLowerCase()], builtIn: false, color: '#5e5ce6' };
    await saveSettings({ categories: [cat, ...settings.categories] });
  }

  async function removeCategory(c: CategoryDef) {
    if (!confirm(`Remove “${c.label}”? Existing appointments keep their records but will be re-classified on the next sync.`)) return;
    await saveSettings({ categories: settings.categories.filter((x) => x.id !== c.id) });
  }

  async function reset() {
    if (!confirm('Reset built-in keywords to defaults? Custom types are kept.')) return;
    await saveSettings({ categories: [...settings.categories.filter((c) => !c.builtIn), ...DEFAULT_CATEGORIES] });
  }

  return (
    <Section
      title="Treatment keywords"
      action={
        <Button small variant="plain" onClick={() => void addCategory()}>
          + Add type
        </Button>
      }
      footer="Event titles are matched against these comma-separated keywords (not case-sensitive). Short keywords like “PT” or “RMT” must be whole words; longer ones also match word beginnings (“physio” matches “physiotherapy”). Custom types are checked first, then the list in order."
    >
      <List>
        {settings.categories.map((c) => (
          <div key={c.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
              {c.builtIn ? (
                <span className="flex-1 text-[15px] font-semibold">{c.label}</span>
              ) : (
                <input className="flex-1 bg-transparent text-[15px] font-semibold outline-none" value={labels[c.id] ?? ''} onChange={(e) => setLabels((l) => ({ ...l, [c.id]: e.target.value }))} onBlur={() => void commit(c)} />
              )}
              {!c.builtIn && (
                <button type="button" className="text-[13px] text-bad" onClick={() => void removeCategory(c)}>
                  Remove
                </button>
              )}
            </div>
            <input
              className="mt-1 w-full bg-transparent text-[15px] text-muted outline-none"
              value={drafts[c.id] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              onBlur={() => void commit(c)}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        ))}
      </List>
      <div className="mt-2">
        <Button small variant="secondary" onClick={() => void reset()}>
          Reset built-in keywords
        </Button>
      </div>
    </Section>
  );
}

function RoutingSection() {
  const { settings } = useData();
  const toast = useToast();
  const [osrm, setOsrm] = useState(settings.osrmUrl);
  const [key, setKey] = useState(settings.orsApiKey);
  useEffect(() => {
    setOsrm(settings.osrmUrl);
    setKey(settings.orsApiKey);
  }, [settings.osrmUrl, settings.orsApiKey]);

  return (
    <Section
      title="Routing (driving distances)"
      footer={
        <>
          OSRM’s public demo server needs no key but is a shared, best-effort service (about 1 request per second, no uptime guarantee). openrouteservice requires a free API key with daily and
          per-minute limits. Both receive only the coordinates of the two points being routed. Results are cached on this device to avoid repeat requests. Routing data © OpenStreetMap contributors.
        </>
      }
    >
      <List>
        <Field label="Provider">
          <Select
            value={settings.routingProvider}
            onChange={(v) => void saveSettings({ routingProvider: v as 'osrm' | 'ors' })}
            options={[
              { value: 'osrm', label: 'OSRM (no key)' },
              { value: 'ors', label: 'openrouteservice (free API key)' },
            ]}
          />
        </Field>
        {settings.routingProvider === 'osrm' ? (
          <Field label="OSRM server URL">
            <TextInput value={osrm} onChange={setOsrm} inputMode="url" placeholder="https://router.project-osrm.org" />
          </Field>
        ) : (
          <Field label="openrouteservice API key" hint="Stored only on this device; not included in backups.">
            <TextInput value={key} onChange={setKey} placeholder="Paste key" />
          </Field>
        )}
      </List>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          small
          variant="secondary"
          onClick={() => void saveSettings({ osrmUrl: osrm.trim() || 'https://router.project-osrm.org', orsApiKey: key.trim() }).then(() => toast('Routing settings saved'))}
        >
          Save routing settings
        </Button>
        <Button
          small
          variant="secondary"
          onClick={() =>
            void clearStore('cache').then(() => toast('Cached routes and address lookups cleared'))
          }
        >
          Clear route cache
        </Button>
      </div>
    </Section>
  );
}

function TripSection() {
  const { settings } = useData();
  return (
    <Section title="Trip recording & display">
      <List>
        <Field label="Ignore GPS fixes less accurate than" hint="Lower is stricter. 50 m suits city driving.">
          <Select value={String(settings.gpsMaxAccuracy)} onChange={(v) => void saveSettings({ gpsMaxAccuracy: Number(v) })} options={[20, 35, 50, 75, 100].map((m) => ({ value: String(m), label: `${m} m` }))} />
        </Field>
        <Field label="Appearance">
          <Select
            value={settings.theme}
            onChange={(v) => void saveSettings({ theme: v as 'system' | 'light' | 'dark' })}
            options={[
              { value: 'system', label: 'Match iPhone setting' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Field>
      </List>
    </Section>
  );
}

function DataSection({ onClose }: { onClose: () => void }) {
  const { settings, fuel, trips, appointments, locations } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const persisted = (await navigator.storage?.persisted?.()) ?? false;
        if (est) setStorage({ used: est.usage ?? 0, quota: est.quota ?? 0, persisted });
      } catch {
        /* not supported */
      }
    })();
  }, [fuel.length, trips.length]);

  async function backup() {
    setBusy('backup');
    try {
      const blob = await createBackup();
      const r = await saveFile(blob, `DriveCare-backup-${todayKey()}.json`);
      toast(r === 'cancelled' ? 'Backup not saved' : 'Backup created — keep it somewhere safe (e.g. iCloud Drive)');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy('');
    }
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    if (!confirm('Restoring replaces ALL records on this device with the backup. Continue?')) return;
    setBusy('restore');
    try {
      const r = await restoreBackup(file);
      toast(`Restored ${r.counts.fuel} fuel, ${r.counts.trips} trips, ${r.counts.appointments} appointments, ${r.counts.locations} places`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy('');
    }
  }

  async function deleteAll() {
    if (!confirm('Delete ALL DriveCare data on this device? This cannot be undone. Make a backup first if you may need it.')) return;
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    await revokeGoogle();
    await clearAll();
    sessionStorage.clear();
    toast('All data deleted');
    onClose();
  }

  async function persist() {
    const ok = (await navigator.storage?.persist?.()) ?? false;
    toast(ok ? 'Storage marked as persistent' : 'The browser did not grant persistent storage', ok ? 'ok' : 'info');
    setStorage((s) => (s ? { ...s, persisted: ok } : s));
  }

  return (
    <Section
      title="Your data"
      footer="All records live only in this app’s storage on this iPhone. Clearing Safari website data, removing DriveCare from the Home Screen, or iOS storage clean-up can erase them — make regular backups and keep them in iCloud Drive or Files. The Home Screen app and Safari have separate storage."
    >
      <List>
        <Row title="Records" subtitle={`${fuel.length} fuel · ${trips.length} trips · ${appointments.length} appointments · ${locations.length} places`} />
        <Row title="Last backup" detail={settings.lastBackupAt ? fmtDateTime(settings.lastBackupAt) : <span className="text-warn">Never</span>} />
        {storage && (
          <Row
            title="Storage used"
            subtitle={storage.persisted ? 'Persistent storage granted' : 'Not marked persistent'}
            detail={`${(storage.used / 1048576).toFixed(1)} MB`}
            right={
              !storage.persisted ? (
                <Button small variant="tinted" onClick={() => void persist()}>
                  Request
                </Button>
              ) : undefined
            }
          />
        )}
      </List>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button onClick={() => void backup()} disabled={!!busy}>
          {busy === 'backup' ? <Spinner size={16} /> : null} Back up data
        </Button>
        <label className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-fill px-4 py-3 text-[16px] font-semibold ${busy ? 'opacity-40' : ''}`}>
          {busy === 'restore' ? <Spinner size={16} /> : null} Restore backup
          <input type="file" accept="application/json,.json" className="hidden" disabled={!!busy} onChange={(e) => void restore(e.target.files?.[0])} />
        </label>
      </div>
      <div className="mt-2">
        <Button full variant="danger" onClick={() => void deleteAll()}>
          Delete all data
        </Button>
      </div>
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title="About">
      <Banner tone="info">
        <div className="space-y-1.5">
          <p>DriveCare · personal use · times shown in Pacific Time (America/Vancouver) · distances in km · amounts in CAD.</p>
          <p>Maps and geocoding © OpenStreetMap contributors (Nominatim). Routing by OSRM or openrouteservice. Calendar data from Google Calendar API (read-only).</p>
          <p>Reports organise your records. They do not determine whether any travel or expense is eligible for reimbursement by ICBC or any insurer.</p>
        </div>
      </Banner>
    </Section>
  );
}
