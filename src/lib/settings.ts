// ─── SQLite-backed App Settings ──────────────────────────────────
//
// Replaces localStorage for all persistent app settings.
// Uses the Electron IPC bridge to read/write from the SQLite
// app_settings table. Falls back to localStorage when not in Electron.

function getAPI(): {
  settingGet: (key: string) => Promise<string | null>;
  settingSet: (key: string, value: string) => Promise<void>;
  settingDelete: (key: string) => Promise<void>;
  settingList: () => Promise<{ key: string; value: string }[]>;
} | null {
  const w = window as unknown as {
    electronAPI?: { db?: Record<string, unknown> };
  };
  return (w.electronAPI?.db as ReturnType<typeof getAPI>) ?? null;
}

/** Get a string setting. Returns null if not set. */
export async function getSetting(key: string): Promise<string | null> {
  const api = getAPI();
  if (api) return api.settingGet(key);
  return localStorage.getItem(key);
}

/** Set a string setting. For objects/arrays, JSON.stringify before calling. */
export async function setSetting(key: string, value: string): Promise<void> {
  const api = getAPI();
  if (api) {
    await api.settingSet(key, value);
  } else {
    localStorage.setItem(key, value);
  }
}

/** Delete a setting. */
export async function deleteSetting(key: string): Promise<void> {
  const api = getAPI();
  if (api) {
    await api.settingDelete(key);
  } else {
    localStorage.removeItem(key);
  }
}

/** Get a JSON-serialized setting, parsed. Returns fallback if not set. */
export async function getSettingJSON<T>(
  key: string,
  fallback: T,
): Promise<T> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Set a JSON-serialized setting. */
export async function setSettingJSON<T>(key: string, value: T): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}

/**
 * One-time migration: rename all "outworked_*" setting keys to "papertrail_*".
 *
 * This runs on app startup (called from App.tsx's init effect).  It is
 * idempotent — if the new keys already exist the old keys are still
 * removed, and if there are no old keys to migrate it returns immediately.
 *
 * Why: settings were stored under the "outworked_" prefix in the SQLite
 * app_settings table and in localStorage (fallback). Renaming them to
 * "papertrail_" keeps the DB clean without leaving orphan rows.
 *
 * Safety: the old key is only deleted after the new key has been written
 * successfully. If writing the new key throws, the old key is preserved.
 */
export async function migrateSettingKeys(): Promise<void> {
  const PREFIX_OLD = "outworked_";
  const PREFIX_NEW = "papertrail_";

  const api = getAPI();
  if (api) {
    // SQLite path
    const entries = await api.settingList();
    const toMigrate = entries.filter(({ key }) => key.startsWith(PREFIX_OLD));
    for (const { key, value } of toMigrate) {
      const newKey = PREFIX_NEW + key.slice(PREFIX_OLD.length);
      // Only write new key if it doesn't already exist (preserve existing value)
      const existing = await api.settingGet(newKey);
      if (existing === null) {
        await api.settingSet(newKey, value);
      }
      await api.settingDelete(key);
    }
  } else {
    // localStorage fallback (dev / web mode)
    const oldKeys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX_OLD));
    for (const oldKey of oldKeys) {
      const newKey = PREFIX_NEW + oldKey.slice(PREFIX_OLD.length);
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey)!);
      }
      localStorage.removeItem(oldKey);
    }
  }
}
