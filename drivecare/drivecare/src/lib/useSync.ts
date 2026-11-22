import { useState } from 'react';
import { useToast } from '../components/ui';
import { useData } from './data';
import { AuthRequiredError, DRIVE_SCOPE, getToken, hasScope, startGoogleAuth } from './google';
import { useNav } from './nav';
import { effectiveClientId } from './settings';
import { syncCalendars } from './sync';
import { cloudSync, CloudScopeError } from './cloud';
import type { AppSettings } from './types';
import { errMsg } from './util';

let running = false;

/** Extra Google permissions needed by the features you turned on. */
export function extraScopes(s: AppSettings): string[] {
  return s.cloudSyncEnabled ? [DRIVE_SCOPE] : [];
}

/** One "Sync" for everything: reads Google Calendar and, if enabled, syncs with your other devices. */
export function useCalendarSync() {
  const { settings } = useData();
  const toast = useToast();
  const nav = useNav();
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    if (running) return;
    const clientId = effectiveClientId(settings);
    if (!clientId) {
      toast('Add your Google OAuth Client ID in Settings first.', 'info');
      nav.openSettings();
      return;
    }
    const cloud = settings.cloudSyncEnabled;
    const hasCalendars = settings.selectedCalendars.length > 0;
    if (!getToken() || (cloud && !hasScope(DRIVE_SCOPE))) {
      startGoogleAuth(clientId, hasCalendars || cloud ? 'sync' : 'connect', extraScopes(settings));
      return;
    }
    if (!hasCalendars && !cloud) {
      toast('Choose which calendars to read in Settings.', 'info');
      nav.openSettings();
      return;
    }
    running = true;
    setSyncing(true);
    try {
      const msgs: string[] = [];
      if (hasCalendars) {
        const s = await syncCalendars();
        msgs.push(`Calendar: ${s.added} new, ${s.updated} updated, ${s.cancelled} cancelled, ${s.removed} removed`);
      }
      if (cloud) {
        const c = await cloudSync();
        msgs.push(`Devices synced${c.downloaded ? ` · ${c.downloaded} update${c.downloaded > 1 ? 's' : ''} received` : ''}`);
      }
      toast(msgs.join(' · '));
    } catch (e) {
      if (e instanceof AuthRequiredError || e instanceof CloudScopeError) startGoogleAuth(clientId, 'sync', extraScopes(settings));
      else toast(errMsg(e), 'error');
    } finally {
      running = false;
      setSyncing(false);
    }
  }

  return { syncing, sync };
}
