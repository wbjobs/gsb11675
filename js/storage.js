// IndexedDB 轻量封装：保存设备记录与操作日志
const DB_NAME = 'web-bt-console';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('devices')) {
        db.createObjectStore('devices', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        db.createObjectStore('logs', { keyPath: 'ts' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result && result._value !== undefined ? result._value : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveDevice(record) {
  return withStore('devices', 'readwrite', (s) => s.put(record));
}

export async function getDevice(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('devices').objectStore('devices').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLog(entry) {
  return withStore('logs', 'readwrite', (s) => s.put(entry));
}

export async function getAllLogs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('logs').objectStore('logs').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearLogs() {
  return withStore('logs', 'readwrite', (s) => s.clear());
}
