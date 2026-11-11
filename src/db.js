// "Mijn opnames": de audiobestanden zelf staan in IndexedDB van de extensie.
// Popup, bibliotheek en offscreen-document delen dezelfde databank.
const recordingsDb = (() => {
  const STORE = 'recordings';
  let dbPromise;

  function open() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('sound-recorder', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    add: (rec) => run('readwrite', (s) => s.add(rec)),
    get: (id) => run('readonly', (s) => s.get(id)),
    put: (rec) => run('readwrite', (s) => s.put(rec)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
    clear: () => run('readwrite', (s) => s.clear()),
    async list() {
      const all = await run('readonly', (s) => s.getAll());
      return all.sort((a, b) => b.created - a.created);
    }
  };
})();
