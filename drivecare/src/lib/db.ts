/** Minimal promise wrapper around IndexedDB with change notifications. */
export type StoreName =
  | 'fuel'
  | 'receipts'
  | 'trips'
  | 'appointments'
  | 'locations'
  | 'routePlans'
  | 'settings'
  | 'cache'
  | 'tombstones';

export const STORES: StoreName[] = ['fuel', 'receipts', 'trips', 'appointments', 'locations', 'routePlans', 'settings', 'cache', 'tombstones'];
/** Stores synced between devices; deletions in these leave a tombstone so they also delete elsewhere. */
export const SYNC_STORES: StoreName[] = ['fuel', 'trips', 'appointments', 'locations', 'routePlans'];
const DB_NAME = 'drivecare';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support IndexedDB storage.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Could not open the local database.'));
    };
    req.onblocked = () => reject(new Error('Database upgrade blocked. Close other DriveCare tabs and reopen.'));
  });
  return dbPromise;
}

async function run<T>(
  store: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result: T | undefined;
    const r = fn(t);
    if (r) r.onsuccess = () => (result = r.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? new Error('Database error'));
    t.onabort = () => reject(t.error ?? new Error('Database transaction aborted'));
  });
}

type Listener = () => void;
const listeners = new Map<StoreName, Set<Listener>>();

export function subscribe(store: StoreName, fn: Listener): () => void {
  let set = listeners.get(store);
  if (!set) listeners.set(store, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

function emit(...stores: StoreName[]) {
  for (const s of stores) listeners.get(s)?.forEach((fn) => fn());
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const r = await run<T[]>(store, 'readonly', (t) => t.objectStore(store).getAll() as IDBRequest<T[]>);
  return r ?? [];
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  return run<T>(store, 'readonly', (t) => t.objectStore(store).get(id) as IDBRequest<T>);
}

export async function put<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  await run(store, 'readwrite', (t) => {
    t.objectStore(store).put(value);
  });
  emit(store);
}

export async function putMany<T extends { id: string }>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return;
  await run(store, 'readwrite', (t) => {
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
  });
  emit(store);
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await removeMany(store, [id]);
}

export async function removeMany(store: StoreName, ids: string[], opts: { tombstone?: boolean } = {}): Promise<void> {
  if (!ids.length) return;
  const tomb = (opts.tombstone ?? true) && SYNC_STORES.includes(store);
  const at = new Date().toISOString();
  await run(tomb ? [store, 'tombstones'] : store, 'readwrite', (t) => {
    const s = t.objectStore(store);
    for (const id of ids) s.delete(id);
    if (tomb) {
      const ts = t.objectStore('tombstones');
      for (const id of ids) ts.put({ id: `${store}:${id}`, at });
    }
  });
  emit(store);
}

export async function clearStore(store: StoreName): Promise<void> {
  await run(store, 'readwrite', (t) => {
    t.objectStore(store).clear();
  });
  emit(store);
}

export async function clearAll(): Promise<void> {
  await run(STORES, 'readwrite', (t) => {
    for (const s of STORES) t.objectStore(s).clear();
  });
  emit(...STORES);
}

/** Replace the entire contents of several stores atomically (used by backup restore). */
export async function replaceAll(data: Partial<Record<StoreName, { id: string }[]>>): Promise<void> {
  const stores = Object.keys(data) as StoreName[];
  await run(stores, 'readwrite', (t) => {
    for (const s of stores) {
      const os = t.objectStore(s);
      os.clear();
      for (const v of data[s] ?? []) os.put(v);
    }
  });
  emit(...stores);
}

/* ---- simple cache with expiry ---- */
export async function cacheGet<T>(id: string, maxAgeMs: number): Promise<T | null> {
  try {
    const rec = await get<{ id: string; value: T; savedAt: number }>('cache', id);
    if (!rec) return null;
    if (Date.now() - rec.savedAt > maxAgeMs) return null;
    return rec.value;
  } catch {
    return null;
  }
}

export async function cacheSet(id: string, value: unknown): Promise<void> {
  try {
    await run('cache', 'readwrite', (t) => {
      t.objectStore('cache').put({ id, value, savedAt: Date.now() });
    });
  } catch {
    /* cache failures are non-fatal */
  }
}
