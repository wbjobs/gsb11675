// IndexedDB 封装：保存手动配置与最近连接记录
const DB_NAME = 'web-bluetooth-console';
const DB_VERSION = 1;
const STORE_MANUAL = 'manualConfigs';
const STORE_HISTORY = 'connectionHistory';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MANUAL)) {
        db.createObjectStore(STORE_MANUAL, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error);
  });
}

export function saveManualConfig(config) {
  return withStore(STORE_MANUAL, 'readwrite', (s) => s.add({ ...config, savedAt: Date.now() }));
}

export function listManualConfigs() {
  return withStore(STORE_MANUAL, 'readonly', (s) => {
    return new Promise((resolve) => {
      const items = [];
      const cursor = s.openCursor();
      cursor.onsuccess = () => {
        if (cursor.result) {
          items.push(cursor.result.value);
          cursor.result.continue();
        } else {
          resolve(items);
        }
      };
    });
  });
}

export function deleteManualConfig(id) {
  return withStore(STORE_MANUAL, 'readwrite', (s) => s.delete(id));
}

export function addHistory(record) {
  return withStore(STORE_HISTORY, 'readwrite', (s) => s.add({ ...record, at: Date.now() }));
}
