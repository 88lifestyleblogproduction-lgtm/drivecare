import { useState } from 'react';
import { useToast } from '../components/ui';
import { useData } from './data';
import { AuthRequiredError, getToken, startGoogleAuth } from './google';
import { useNav } from './nav';
import { effectiveClientId } from './settings';
import { syncCalendars } from './sync';
import { errMsg } from './util';

let running = false;

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
    if (!getToken()) {
      startGoogleAuth(clientId, settings.selectedCalendars.length ? 'sync' : 'connect');
      return;
    }
    if (!settings.selectedCalendars.length) {
      toast('Choose which calendars to read in Settings.', 'info');
      nav.openSettings();
      return;
    }
    running = true;
    setSyncing(true);
    try {
      const s = await syncCalendars();
      toast(`Synced · ${s.added} new, ${s.updated} updated, ${s.cancelled} cancelled, ${s.removed} removed`);
    } catch (e) {
      if (e instanceof AuthRequiredError) startGoogleAuth(clientId, 'sync');
      else toast(errMsg(e), 'error');
    } finally {
      running = false;
      setSyncing(false);
    }
  }

  return { syncing, sync };
}
