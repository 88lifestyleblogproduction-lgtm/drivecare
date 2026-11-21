/**
 * Sync between devices through the user's own Google Drive "appDataFolder":
 * a hidden folder only DriveCare can read (scope drive.appdata). No DriveCare server is involved.
 *
 * One JSON file holds all records. Each sync downloads it, merges record by record
 * (newest `updatedAt` wins; deletions are carried as tombstones), saves the result
 * locally and uploads it again.
 */
import { getAll, putMany, removeMany, SYNC_STORES, type StoreName } from './db';
import { DRIVE_SCOPE, googleFetch, hasScope, AuthRequiredError } from './google';
import { loadSettings, saveSettings, SYNCED_PREF_KEYS } from './settings';
import { base64ToBuffer, bufferToBase64 } from './files';
import type { AppSettings, ReceiptRecord } from './types';
import { errMsg } from './util';

const FILE_NAME = 'drivecare-sync.json';
const TOMBSTONE_DAYS = 365;

interface Row {
  id: string;
  updatedAt?: string;
}
interface Tombstone {
  id: string; // `${store}:${recordId}`
  at: string;
}
interface CloudFile {
  app: 'DriveCare';
  format: 1;
  savedAt: string;
  data: Partial<Record<StoreName, Row[]>>;
  receipts: { id: string; type: string; base64: string }[];
  tombstones: Tombstone[];
  prefs: Partial<AppSettings>;
  prefsUpdatedAt: string;
}

export class CloudScopeError extends Error {
  constructor() {
    super('Google Drive permission is needed for syncing between devices.');
    this.name = 'CloudScopeError';
  }
}

async function findFile(): Promise<string | null> {
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name='${FILE_NAME}' and trashed=false`, fields: 'files(id,modifiedTime)', pageSize: '10' });
  const res = await googleFetch(`https://www.googleapis.com/drive/v3/files?${q}`);
  if (res.status === 403) throw new Error(await driveError(res));
  if (!res.ok) throw new Error(await driveError(res));
  const j = (await res.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

async function driveError(res: Response): Promise<string> {
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* ignore */
  }
  if (/has not been used|disabled/i.test(detail)) return 'The Google Drive API is not enabled in your Google Cloud project. Enable it, then sync again.';
  return `Google Drive error ${res.status}${detail ? `: ${detail}` : ''}`;
}

async function download(id: string): Promise<CloudFile | null> {
  const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, 60000);
  if (!res.ok) throw new Error(await driveError(res));
  try {
    const j = (await res.json()) as CloudFile;
    return j && j.app === 'DriveCare' ? j : null;
  } catch {
    return null;
  }
}

async function upload(id: string | null, file: CloudFile): Promise<void> {
  const body = JSON.stringify(file);
  if (id) {
    const res = await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, 60000);
    if (!res.ok) throw new Error(await driveError(res));
    return;
  }
  const boundary = `dc${Date.now()}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    body +
    `\r\n--${boundary}--`;
  const res = await googleFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart },
    60000
  );
  if (!res.ok) throw new Error(await driveError(res));
}

const newer = (a?: string, b?: string) => (a ?? '') > (b ?? '');

export interface CloudResult {
  downloaded: number;
  deleted: number;
  uploaded: boolean;
}

let running = false;
/** Local writes made by a sync itself should not trigger another sync. */
export let cloudQuietUntil = 0;
export const cloudRunning = () => running;

export async function cloudSync(): Promise<CloudResult> {
  if (running) return { downloaded: 0, deleted: 0, uploaded: false };
  if (!hasScope(DRIVE_SCOPE)) throw new CloudScopeError();
  running = true;
  try {
    const fileId = await findFile();
    const remote = fileId ? await download(fileId) : null;

    // Tombstones: union, newest time wins, prune very old ones
    const localTombs = await getAll<Tombstone>('tombstones');
    const tombs = new Map<string, string>();
    for (const t of [...localTombs, ...(remote?.tombstones ?? [])]) if (newer(t.at, tombs.get(t.id))) tombs.set(t.id, t.at);
    const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
    for (const [k, at] of tombs) if (at < cutoff) tombs.delete(k);

    let downloaded = 0;
    let deleted = 0;
    const merged: Partial<Record<StoreName, Row[]>> = {};
    for (const store of SYNC_STORES) {
      const local = await getAll<Row>(store);
      const localMap = new Map(local.map((r) => [r.id, r]));
      const all = new Map(localMap);
      for (const r of remote?.data[store] ?? []) {
        if (!r || typeof r.id !== 'string') continue;
        const cur = all.get(r.id);
        if (!cur || newer(r.updatedAt, cur.updatedAt)) all.set(r.id, r);
      }
      // apply deletions that happened after the record's last change
      for (const [id, r] of all) {
        const t = tombs.get(`${store}:${id}`);
        if (t && !newer(r.updatedAt, t)) all.delete(id);
      }
      const toPut = [...all.values()].filter((r) => {
        const l = localMap.get(r.id);
        return !l || newer(r.updatedAt, l.updatedAt);
      });
      const toDelete = local.filter((r) => !all.has(r.id)).map((r) => r.id);
      await putMany(store, toPut);
      await removeMany(store, toDelete, { tombstone: false });
      downloaded += toPut.length;
      deleted += toDelete.length;
      merged[store] = [...all.values()];
    }

    // Tombstones saved locally
    await putMany(
      'tombstones',
      [...tombs].map(([id, at]) => ({ id, at }))
    );

    // Receipts follow their fuel purchase
    const fuelIds = new Set((merged.fuel ?? []).map((r) => r.id));
    const localReceipts = await getAll<ReceiptRecord>('receipts');
    const haveReceipt = new Set(localReceipts.map((r) => r.id));
    const remoteReceipts = (remote?.receipts ?? []).filter((r) => fuelIds.has(r.id));
    const newReceipts = remoteReceipts.filter((r) => !haveReceipt.has(r.id)).map((r): ReceiptRecord => ({ id: r.id, type: r.type, data: base64ToBuffer(r.base64) }));
    await putMany('receipts', newReceipts);
    const receiptOut = new Map<string, { id: string; type: string; base64: string }>();
    for (const r of remoteReceipts) receiptOut.set(r.id, r);
    for (const r of localReceipts) if (fuelIds.has(r.id) && !receiptOut.has(r.id)) receiptOut.set(r.id, { id: r.id, type: r.type, base64: bufferToBase64(r.data) });

    // Settings that follow you between devices
    const settings = await loadSettings();
    let prefs: Partial<AppSettings> = pickPrefs(settings);
    let prefsAt = settings.prefsUpdatedAt;
    if (remote?.prefs && newer(remote.prefsUpdatedAt, settings.prefsUpdatedAt)) {
      prefs = pickPrefs({ ...settings, ...remote.prefs });
      prefsAt = remote.prefsUpdatedAt;
      await saveSettings({ ...prefs, prefsUpdatedAt: prefsAt }, { fromSync: true });
    }

    const out: CloudFile = {
      app: 'DriveCare',
      format: 1,
      savedAt: new Date().toISOString(),
      data: merged,
      receipts: [...receiptOut.values()],
      tombstones: [...tombs].map(([id, at]) => ({ id, at })),
      prefs,
      prefsUpdatedAt: prefsAt,
    };
    await upload(fileId, out);
    await saveSettings({ lastCloudSync: out.savedAt, lastCloudError: null });
    return { downloaded, deleted, uploaded: true };
  } catch (e) {
    if (!(e instanceof AuthRequiredError)) await saveSettings({ lastCloudError: errMsg(e) }).catch(() => undefined);
    throw e;
  } finally {
    running = false;
    cloudQuietUntil = Date.now() + 300;
  }
}

function pickPrefs(s: AppSettings): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const k of SYNCED_PREF_KEYS) out[k] = s[k];
  return out as Partial<AppSettings>;
}

/** Removes DriveCare's sync file from Google Drive (records on this device are kept). */
export async function deleteCloudCopy(): Promise<void> {
  const id = await findFile();
  if (!id) return;
  const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(await driveError(res));
}
