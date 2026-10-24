// Stockage local sur l'appareil (IndexedDB) : projets, photos, visites.
const DB_NAME = 'chantier-photo';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('projectId', 'projectId');
        const walks = db.createObjectStore('walkthroughs', { keyPath: 'id' });
        walks.createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function put(name, value) {
  return wrap((await store(name, 'readwrite')).put(value));
}

export async function get(name, id) {
  return wrap((await store(name)).get(id));
}

export async function del(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}

export async function all(name) {
  return wrap((await store(name)).getAll());
}

export async function byProject(name, projectId) {
  return wrap((await store(name)).index('projectId').getAll(projectId));
}

export async function deleteProject(projectId) {
  for (const p of await byProject('photos', projectId)) await del('photos', p.id);
  for (const w of await byProject('walkthroughs', projectId)) await del('walkthroughs', w.id);
  await del('projects', projectId);
}

// Demande au navigateur de ne pas effacer les données en cas de manque de place.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* non bloquant */ }
}
