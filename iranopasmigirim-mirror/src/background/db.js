// Thin IndexedDB wrapper. We deliberately don't pull in `idb` (npm) — the
// surface we need is small enough that a few dozen lines of native IDB are
// clearer to audit than a 4 KB dependency. Every method is async + boring.
//
// Schema (version 1):
//   files:  key=path (string), value={content: ArrayBuffer, mimeType, sha}
//   meta:   key=string, value=any   (last tree SHA, last sync time, etc.)

const DB_NAME = 'iranopasmigirim-mirror';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // `files` stores cached site content keyed by path. No indexes — every
      // access is by primary key, so an index would just cost write time.
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return open().then((db) => {
    const t = db.transaction(storeName, mode);
    return t.objectStore(storeName);
  });
}

// Wrap an IDBRequest in a promise. IDB's API predates promises by a decade,
// so every call needs this dance.
function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

export async function getFile(path) {
  const store = await tx('files', 'readonly');
  return req(store.get(path));
}

export async function putFile(path, record) {
  const store = await tx('files', 'readwrite');
  return req(store.put(record, path));
}

export async function deleteFile(path) {
  const store = await tx('files', 'readwrite');
  return req(store.delete(path));
}

// Return all known paths. Used by the sync engine to compute the diff
// against an incoming tree. Uses getAllKeys (much cheaper than getAll for
// an existence check, since we don't need the bodies).
export async function listPaths() {
  const store = await tx('files', 'readonly');
  return req(store.getAllKeys());
}

// Aggregate stats for the popup. Walks every value once — fine for the
// scale we expect (low-thousands of files). If this ever gets slow we can
// store running totals in `meta`.
export async function stats() {
  const store = await tx('files', 'readonly');
  return new Promise((resolve, reject) => {
    let count = 0;
    let bytes = 0;
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        count++;
        const v = cursor.value;
        if (v && v.content && v.content.byteLength) bytes += v.content.byteLength;
        cursor.continue();
      } else {
        resolve({ count, bytes });
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function clearAll() {
  const filesStore = await tx('files', 'readwrite');
  await req(filesStore.clear());
  const metaStore = await tx('meta', 'readwrite');
  await req(metaStore.clear());
}

export async function getMeta(key) {
  const store = await tx('meta', 'readonly');
  return req(store.get(key));
}

export async function putMeta(key, value) {
  const store = await tx('meta', 'readwrite');
  return req(store.put(value, key));
}

export async function putMetaBatch(entries) {
  const db = await open();
  const t = db.transaction('meta', 'readwrite');
  const store = t.objectStore('meta');
  for (const [key, value] of entries) {
    store.put(value, key);
  }
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Periodic hygiene sweep: remove malformed or oversized records so stale
// bad entries cannot accumulate forever.
export async function compactFiles(maxBytes) {
  const store = await tx('files', 'readwrite');
  return new Promise((resolve, reject) => {
    let scanned = 0;
    let removed = 0;
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) {
        resolve({ scanned, removed });
        return;
      }

      scanned++;
      const value = cursor.value || {};
      const size = value && value.content && typeof value.content.byteLength === 'number'
        ? value.content.byteLength
        : -1;
      const sha = typeof value.sha === 'string' ? value.sha : '';
      const validSha = /^[0-9a-f]{40}$/i.test(sha);
      const shouldRemove = size < 0 || size > maxBytes || !validSha;
      if (!shouldRemove) {
        cursor.continue();
        return;
      }

      const delReq = cursor.delete();
      delReq.onsuccess = () => {
        removed++;
        cursor.continue();
      };
      delReq.onerror = () => reject(delReq.error);
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}
