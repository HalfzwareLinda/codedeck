/**
 * Persistent key-value store.
 *
 * Uses @tauri-apps/plugin-store when running inside Tauri (desktop/Android),
 * falling back to localStorage for browser mock mode.
 *
 * The Tauri store writes to a JSON file in the app data directory which
 * survives app restarts — unlike localStorage in Android WebViews.
 */

import { isTauri } from '../ipc/tauri';

type TauriStore = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  save: () => Promise<void>;
};

let store: TauriStore | null = null;
let initPromise: Promise<void> | null = null;

/** Keys that may have data in localStorage from before the Tauri store migration. */
const MIGRATE_KEYS = ['codedeck_machines', 'codedeck_dm'];

async function init(): Promise<void> {
  if (store) return;
  if (!isTauri()) return;

  try {
    const mod = await import('@tauri-apps/plugin-store');
    store = await mod.load('codedeck-data.json', { defaults: {}, autoSave: true });
    await migrateFromLocalStorage();
  } catch (e) {
    console.warn('[PersistStore] Failed to init Tauri store, falling back to localStorage:', e);
  }
}

/**
 * One-time migration: copy any data left in localStorage by the pre-store
 * version into the Tauri store, then remove the localStorage keys.
 */
async function migrateFromLocalStorage(): Promise<void> {
  if (!store) return;
  for (const key of MIGRATE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const existing = await store.get(key);
      if (existing !== undefined) continue; // already migrated
      const parsed = JSON.parse(raw);
      await store.set(key, parsed);
      localStorage.removeItem(key);
      console.log(`[PersistStore] Migrated "${key}" from localStorage to Tauri store`);
    } catch (e) {
      console.warn(`[PersistStore] Migration of "${key}" failed:`, e);
    }
  }
}

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

export async function persistGet<T>(key: string): Promise<T | null> {
  await ensureInit();

  if (store) {
    try {
      const val = await store.get<T>(key);
      return val ?? null;
    } catch (e) {
      console.error(`[PersistStore] get(${key}) failed:`, e);
      return null;
    }
  }

  // Fallback: localStorage (browser mock mode)
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function persistSet(key: string, value: unknown): Promise<void> {
  await ensureInit();

  if (store) {
    try {
      await store.set(key, value);
    } catch (e) {
      console.error(`[PersistStore] set(${key}) failed:`, e);
    }
    return;
  }

  // Fallback: localStorage
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* full or unavailable */ }
}

export async function persistDelete(key: string): Promise<void> {
  await ensureInit();

  if (store) {
    try {
      await store.delete(key);
    } catch (e) {
      console.error(`[PersistStore] delete(${key}) failed:`, e);
    }
    return;
  }

  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}
