/** Storage adapter — swap this for an API-backed adapter later without touching gameplay code. */
export interface StorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export const localStorageAdapter: StorageAdapter = {
  read(key) { try { return localStorage.getItem(key); } catch { return null; } },
  write(key, value) { try { localStorage.setItem(key, value); } catch { /* quota / private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

export const memoryAdapter = (): StorageAdapter => {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
};
