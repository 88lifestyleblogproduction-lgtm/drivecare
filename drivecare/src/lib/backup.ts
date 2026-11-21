import { getAll, replaceAll, type StoreName } from './db';
import { base64ToBuffer, bufferToBase64 } from './files';
import { saveSettings, withDefaults } from './settings';
import type { AppSettings, ReceiptRecord } from './types';

const DATA_STORES: StoreName[] = ['fuel', 'trips', 'appointments', 'locations', 'routePlans'];

interface BackupFile {
  app: 'DriveCare';
  format: 1;
  exportedAt: string;
  data: Record<string, { id: string }[]>;
  settings: Partial<AppSettings>;
  receipts: { id: string; type: string; base64: string }[];
}

/** Backups contain your records but never Google tokens or API keys. */
export async function createBackup(): Promise<Blob> {
  const data: Record<string, { id: string }[]> = {};
  for (const s of DATA_STORES) data[s] = await getAll<{ id: string }>(s);
  const settings = withDefaults((await getAll<AppSettings>('settings'))[0]);
  const receipts = (await getAll<ReceiptRecord>('receipts')).map((r) => ({ id: r.id, type: r.type, base64: bufferToBase64(r.data) }));
  const file: BackupFile = {
    app: 'DriveCare',
    format: 1,
    exportedAt: new Date().toISOString(),
    data,
    settings: { ...settings, orsApiKey: '', googleConnected: false },
    receipts,
  };
  await saveSettings({ lastBackupAt: file.exportedAt });
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export interface RestoreSummary {
  counts: Record<string, number>;
  exportedAt: string;
}

/** Replaces all local records with the backup's contents. */
export async function restoreBackup(file: File): Promise<RestoreSummary> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(await file.text()) as BackupFile;
  } catch {
    throw new Error('That file is not a valid DriveCare backup (could not read JSON).');
  }
  if (!parsed || parsed.app !== 'DriveCare' || parsed.format !== 1 || typeof parsed.data !== 'object') {
    throw new Error('That file is not a DriveCare backup.');
  }
  const payload: Partial<Record<StoreName, { id: string }[]>> = {};
  const counts: Record<string, number> = {};
  for (const s of DATA_STORES) {
    const rows = Array.isArray(parsed.data[s]) ? parsed.data[s].filter((r) => r && typeof r.id === 'string') : [];
    payload[s] = rows;
    counts[s] = rows.length;
  }
  payload.receipts = (parsed.receipts ?? [])
    .filter((r) => r && r.id && r.base64)
    .map((r): ReceiptRecord => ({ id: r.id, type: r.type || 'image/jpeg', data: base64ToBuffer(r.base64) }));
  counts.receipts = payload.receipts.length;
  const current = withDefaults((await getAll<AppSettings>('settings'))[0]);
  const restored = withDefaults({
    ...parsed.settings,
    // keep this device's credentials/connection state
    orsApiKey: current.orsApiKey,
    googleClientId: parsed.settings?.googleClientId || current.googleClientId,
    googleConnected: false,
  });
  payload.settings = [restored];
  await replaceAll(payload);
  return { counts, exportedAt: parsed.exportedAt };
}
