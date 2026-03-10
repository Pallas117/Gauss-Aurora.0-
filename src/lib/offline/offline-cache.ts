export interface OfflineCacheEntry<T> {
  key: string;
  data: T;
  cachedAt: number;
  expiresAt: number | null;
}

const DB_NAME = "gauss-offline-cache-v1";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const LOCAL_STORAGE_PREFIX = "gauss.offline.";

let dbPromise: Promise<IDBDatabase> | null = null;

function supportsIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function isExpired(entry: { expiresAt: number | null }): boolean {
  return typeof entry.expiresAt === "number" && entry.expiresAt <= Date.now();
}

function toCacheEntry<T>(key: string, data: T, ttlMs?: number): OfflineCacheEntry<T> {
  const cachedAt = Date.now();
  const expiresAt =
    typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 ? cachedAt + ttlMs : null;
  return {
    key,
    data,
    cachedAt,
    expiresAt,
  };
}

function localStorageKey(key: string): string {
  return `${LOCAL_STORAGE_PREFIX}${key}`;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function openDb(): Promise<IDBDatabase> {
  if (!supportsIndexedDb()) {
    throw new Error("indexeddb_unavailable");
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

async function idbSet<T>(entry: OfflineCacheEntry<T>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_write_failed"));
    tx.oncomplete = () => resolve();
  });
}

async function idbGet<T>(key: string): Promise<OfflineCacheEntry<T> | null> {
  const db = await openDb();
  return new Promise<OfflineCacheEntry<T> | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_read_failed"));
    request.onsuccess = () => {
      const raw = request.result as OfflineCacheEntry<T> | undefined;
      resolve(raw ?? null);
    };
  });
}

async function idbRemove(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_delete_failed"));
    tx.oncomplete = () => resolve();
  });
}

function lsSet<T>(entry: OfflineCacheEntry<T>): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  storage.setItem(localStorageKey(entry.key), JSON.stringify(entry));
}

function lsGet<T>(key: string): OfflineCacheEntry<T> | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  const raw = storage.getItem(localStorageKey(key));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as OfflineCacheEntry<T>;
  } catch {
    return null;
  }
}

function lsRemove(key: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(localStorageKey(key));
}

export async function writeOfflineCache<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  const entry = toCacheEntry(key, data, ttlMs);
  try {
    await idbSet(entry);
  } catch {
    lsSet(entry);
  }
}

export async function readOfflineCache<T>(key: string): Promise<OfflineCacheEntry<T> | null> {
  let entry: OfflineCacheEntry<T> | null = null;
  try {
    entry = await idbGet<T>(key);
  } catch {
    entry = lsGet<T>(key);
  }

  if (!entry) {
    return null;
  }
  if (isExpired(entry)) {
    await removeOfflineCache(key);
    return null;
  }
  return entry;
}

export async function removeOfflineCache(key: string): Promise<void> {
  try {
    await idbRemove(key);
  } catch {
    lsRemove(key);
  }
}

export async function readCachedData<T>(key: string): Promise<T | null> {
  const entry = await readOfflineCache<T>(key);
  return entry?.data ?? null;
}
