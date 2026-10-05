// Read-only recipe data from the static API. URLs are relative so the site works under /<repo>/.
import { getMeta, setMeta } from './db.js';

const memo = new Map();
function getJSON(path) {
  if (!memo.has(path)) {
    memo.set(path, fetch(path).then(r => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }).catch(e => { memo.delete(path); throw e; }));
  }
  return memo.get(path);
}

export const getIndex = () => getJSON('api/index.json');
export const getCatalog = () => getJSON('api/catalog.json').then(c => c.items);
export const getCategories = () => getJSON('api/categories/index.json');
export const getRecipe = slug => getJSON(`api/recipes/${encodeURIComponent(slug)}.json`);

export async function indexById() {
  return new Map((await getIndex()).map(e => [e.id, e]));
}
export async function getRecipeById(id) {
  const entry = (await indexById()).get(id);
  return entry ? getRecipe(entry.slug) : null;
}

/**
 * Compare api/version.json with the version this device last saw. When it changed, ask the
 * service worker to re-download the API, then drop in-memory copies. Returns true if data changed.
 */
export async function checkForUpdate() {
  let latest;
  try {
    latest = (await (await fetch('api/version.json', { cache: 'no-store' })).json()).version;
  } catch {
    return false; // offline
  }
  const seen = await getMeta('apiVersion');
  if (seen === latest) return false;
  if (seen && navigator.serviceWorker?.controller) {
    // the worker re-downloads ~280 files; give up after two minutes (e.g. the worker was stopped) and retry later
    const ok = await new Promise(resolve => {
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 120000);
      ch.port1.onmessage = e => { clearTimeout(timer); resolve(e.data?.ok); };
      navigator.serviceWorker.controller.postMessage({ type: 'refresh-api' }, [ch.port2]);
    });
    if (!ok) return false; // try again next launch
  }
  memo.clear();
  await setMeta('apiVersion', latest);
  return !!seen;
}
