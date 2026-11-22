/**
 * Google Calendar access with OAuth 2.0 (browser-only "token" flow, no client secret).
 *
 * - Scope: calendar.readonly (read-only).
 * - Uses a full-page redirect rather than a popup because popups are unreliable in
 *   iOS Home Screen apps.
 * - The access token lives only in sessionStorage (cleared when the app is closed) and
 *   expires after about an hour. It is never written to IndexedDB or to backups.
 * - No refresh token is ever issued to the browser; "Sync" re-authorises when needed,
 *   which is a single tap once consent has been given.
 */
import { fetchWithTimeout } from './net';
import type { CalendarRef } from './types';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
/** Hidden app-only folder in your Google Drive (DriveCare cannot see your other Drive files) */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'drivecare.gtoken';
const STATE_KEY = 'drivecare.oauth';
const API = 'https://www.googleapis.com/calendar/v3';

export class AuthRequiredError extends Error {
  constructor(msg = 'Google authorisation expired. Tap “Connect” to continue.') {
    super(msg);
    this.name = 'AuthRequiredError';
  }
}

export type AuthIntent = 'connect' | 'sync';

export function redirectUri(): string {
  return `${window.location.origin}/`;
}

function randomState(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function startGoogleAuth(clientId: string, intent: AuthIntent, extraScopes: string[] = []): void {
  if (!clientId) throw new Error('Enter your Google OAuth Client ID in Settings first.');
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, intent, at: Date.now() }));
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: [GOOGLE_SCOPE, ...extraScopes].join(' '),
    include_granted_scopes: 'true',
    state,
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`);
}

export type RedirectResult = { ok: true; intent: AuthIntent } | { ok: false; error: string };

/** Call once on startup. Consumes an OAuth response in the URL fragment, if present. */
export function consumeOAuthRedirect(): RedirectResult | null {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (!hash || !(hash.includes('access_token=') || hash.includes('error='))) return null;
  const params = new URLSearchParams(hash);
  // Remove the token from the address bar and history immediately.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  let saved: { state: string; intent: AuthIntent } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
  } catch {
    saved = null;
  }
  sessionStorage.removeItem(STATE_KEY);

  if (!saved || saved.state !== params.get('state')) {
    return { ok: false, error: 'Sign-in response could not be verified (state mismatch). Please try again.' };
  }
  const err = params.get('error');
  if (err) {
    return { ok: false, error: err === 'access_denied' ? 'Google Calendar access was not granted.' : `Google sign-in error: ${err}` };
  }
  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || '3600');
  const scope = params.get('scope') || '';
  if (!token) return { ok: false, error: 'No access token received from Google.' };
  if (!scope.split(' ').includes(GOOGLE_SCOPE)) {
    return { ok: false, error: 'Calendar read access was not granted. Tick the calendar permission on the Google consent screen.' };
  }
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + expiresIn * 1000, scopes: scope.split(' ') }));
  return { ok: true, intent: saved.intent };
}

export function getToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as { token: string; expiresAt: number };
    if (!t.token || Date.now() > t.expiresAt - 60_000) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return t.token;
  } catch {
    return null;
  }
}

/** True when the current sign-in includes the given permission. */
export function hasScope(scope: string): boolean {
  if (!getToken()) return false;
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null') as { scopes?: string[] } | null;
    return !!t?.scopes?.includes(scope);
  } catch {
    return false;
  }
}

/** Authenticated request to any Google API. */
export async function googleFetch(url: string, init: RequestInit = {}, ms = 30000): Promise<Response> {
  const token = getToken();
  if (!token) throw new AuthRequiredError();
  const res = await fetchWithTimeout(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } }, ms);
  if (res.status === 401) {
    clearToken();
    throw new AuthRequiredError();
  }
  return res;
}

export function tokenMinutesLeft(): number {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null') as { expiresAt: number } | null;
    return t ? Math.max(0, Math.round((t.expiresAt - Date.now()) / 60000)) : 0;
  } catch {
    return 0;
  }
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Revokes the current token at Google (best effort) and forgets it locally. */
export async function revokeGoogle(): Promise<void> {
  const token = getToken();
  clearToken();
  if (!token) return;
  try {
    await fetchWithTimeout('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
  } catch {
    /* ignore: token is short-lived and already forgotten locally */
  }
}

async function gget<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) throw new AuthRequiredError();
  const res = await fetchWithTimeout(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }, 20000);
  if (res.status === 401) {
    clearToken();
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? '';
    } catch {
      /* ignore */
    }
    if (res.status === 403 && /has not been used|disabled/i.test(detail)) {
      throw new Error('The Google Calendar API is not enabled for your Google Cloud project. Enable it, then retry.');
    }
    throw new Error(`Google Calendar error ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export async function listCalendars(): Promise<(CalendarRef & { primary: boolean })[]> {
  const out: (CalendarRef & { primary: boolean })[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ minAccessRole: 'reader', fields: 'items(id,summary,summaryOverride,primary),nextPageToken' });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await gget<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[]; nextPageToken?: string }>(
      `/users/me/calendarList?${q}`
    );
    for (const c of j.items ?? []) out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary });
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

export interface GEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  location?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** Only the fields DriveCare needs are requested (no descriptions, attendees, etc.). */
export async function fetchEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      timeMin,
      timeMax,
      maxResults: '2500',
      fields: 'items(id,status,summary,location,updated,start,end),nextPageToken',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await gget<{ items?: GEvent[]; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    out.push(...(j.items ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}
