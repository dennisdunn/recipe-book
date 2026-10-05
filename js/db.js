// Per-device user data in IndexedDB. Everything about a recipe is keyed by its immutable `id`.
//
//   stats  { id, rating, favorite, main, excluded, timesRecommended, lastRecommended, timesCooked, lastCooked }
//          `main` is an override of the recipe's "main" tag (undefined = use the tag)
//   notes  { id, text, updated }
//   plans  see planner.js; key is the plan's start date
//   meta   key/value: currentPlan, settings, apiVersion
import { openDB } from './vendor/idb.js';

const STORES = ['stats', 'notes', 'plans', 'meta'];

const dbp = openDB('recipe-book', 1, {
  upgrade(db) {
    db.createObjectStore('stats', { keyPath: 'id' });
    db.createObjectStore('notes', { keyPath: 'id' });
    db.createObjectStore('plans', { keyPath: 'id' });
    db.createObjectStore('meta');
  },
});

export async function allStats() {
  return new Map((await (await dbp).getAll('stats')).map(s => [s.id, s]));
}
export async function getStat(id) {
  return (await (await dbp).get('stats', id)) ?? { id };
}
/** Merge `patch` into a recipe's stats; a function patch receives the current record. */
export async function updateStat(id, patch) {
  const db = await dbp;
  const tx = db.transaction('stats', 'readwrite');
  const cur = (await tx.store.get(id)) ?? { id };
  const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), id };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function getNote(id) {
  return (await (await dbp).get('notes', id))?.text ?? '';
}
export async function setNote(id, text) {
  const db = await dbp;
  if (text.trim()) await db.put('notes', { id, text, updated: new Date().toISOString() });
  else await db.delete('notes', id);
}

export const getPlan = async id => (await dbp).get('plans', id);
export const putPlan = async plan => (await dbp).put('plans', plan);

export const getMeta = async key => (await dbp).get('meta', key);
export const setMeta = async (key, value) => (await dbp).put('meta', value, key);

export async function exportAll() {
  const db = await dbp;
  const out = { app: 'recipe-book', exportVersion: 1, exportedAt: new Date().toISOString(), stores: {} };
  for (const name of STORES) {
    if (name === 'meta') {
      const keys = await db.getAllKeys('meta');
      out.stores.meta = await Promise.all(keys.map(async key => ({ key, value: await db.get('meta', key) })));
    } else {
      out.stores[name] = await db.getAll(name);
    }
  }
  return out;
}

/** Replace all user data with an export file's contents. */
export async function importAll(data) {
  if (data?.app !== 'recipe-book' || !data.stores) throw new Error("This is not an Adele's Recipe Book backup file.");
  const db = await dbp;
  const tx = db.transaction(STORES, 'readwrite');
  const apiVersion = await tx.objectStore('meta').get('apiVersion'); // describes this device's cache, not the backup
  for (const name of STORES) {
    const store = tx.objectStore(name);
    await store.clear();
    if (name === 'meta' && apiVersion) await store.put(apiVersion, 'apiVersion');
    for (const row of data.stores[name] ?? []) {
      if (name === 'meta') { if (row.key !== 'apiVersion') await store.put(row.value, row.key); }
      else await store.put(row);
    }
  }
  await tx.done;
}
