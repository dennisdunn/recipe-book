// Boot + hash router.
// Simple view (the default): #/ (home), #/choose, #/tonight.
// Helper view: #/plan, #/menu, #/plans, #/shop, #/pantry, #/can-make, #/recipes, #/recipe/<slug>, #/settings
import { checkForUpdate } from './data.js';
import { toast, html, view, takeScrollTop } from './ui.js';
import * as plan from './views/plan.js';
import * as shop from './views/shop.js';
import * as recipes from './views/recipes.js';
import * as recipe from './views/recipe.js';
import * as settings from './views/settings.js';
import * as pantry from './views/pantry.js';
import * as canMake from './views/canmake.js';
import * as plans from './views/plans.js';
import * as menu from './views/menu.js';
import * as simple from './views/simple.js';

// [path, screen, helper tab (null = simple view), params]
const ROUTES = [
  [/^\/?$/, { render: simple.home }, null],
  [/^\/choose$/, { render: simple.choose }, null],
  [/^\/tonight$/, { render: simple.tonight }, null],
  [/^\/plan$/, plan, 'plan'],
  [/^\/plans$/, plans, 'plan'],
  [/^\/menu$/, menu, 'plan'],
  [/^\/shop$/, shop, 'shop'],
  [/^\/recipes$/, recipes, 'recipes'],
  [/^\/recipe\/([a-z0-9-]+)$/, recipe, 'recipes', m => ({ slug: m[1] })],
  [/^\/settings$/, settings, 'settings'],
  [/^\/pantry$/, pantry, 'pantry'],
  [/^\/can-make$/, canMake, 'pantry'],
];

const main = document.getElementById('main');
let shown = { path: null, el: null };
let seq = 0;

async function route() {
  const path = decodeURIComponent(location.hash.slice(1)) || '/';
  let match, mod, tab, params;
  for (const [re, m, t, p] of ROUTES) if ((match = path.match(re))) { [mod, tab, params] = [m, t, p?.(match) ?? {}]; break; }
  const mode = mod && tab === null ? 'simple' : 'helper';
  const sameView = path === shown.path;
  const scroll = window.scrollY;
  const n = ++seq;
  let el;
  try {
    el = mod ? await mod.render(params) : view(html`<h1>Not found</h1><a class="btn" href="#/">Home</a>`);
  } catch (err) {
    console.error(err);
    el = view(html`<h1>Something went wrong</h1><p class="lead">${err.message}</p>
      <p>If you are offline, this page may not have been saved yet.</p><a class="btn" href="#/">Home</a>`);
  }
  if (n !== seq) return el.cleanup?.(); // a newer navigation finished first
  shown.el?.cleanup?.();
  main.replaceChildren(el);
  shown = { path, el };
  document.querySelectorAll('.tabs a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === tab));
  document.body.dataset.mode = mode;               // simple view: no tab bar; helper view: tabs + "Simple view"
  document.body.dataset.home = String(path === '/'); // the Home button is hidden on Home itself
  const heading = el.querySelector('h1')?.textContent.trim();
  document.title = heading && mode === 'helper' && tab !== 'plan' ? `${heading} · Adele's Recipe Book` : "Adele's Recipe Book";
  const top = takeScrollTop();
  window.scrollTo(0, sameView && !top ? scroll : 0);
  if (!sameView) main.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);

// print collapsed sections (nutrition) expanded, then put them back
let closedForPrint = [];
window.addEventListener('beforeprint', () => {
  closedForPrint = [...document.querySelectorAll('details:not([open])')];
  closedForPrint.forEach(d => { d.open = true; });
});
window.addEventListener('afterprint', () => closedForPrint.forEach(d => { d.open = false; }));
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker not registered', err));
}
navigator.storage?.persist?.();

// New recipe data? Refresh quietly and redraw the current view.
async function update() {
  if (await checkForUpdate()) { toast('Recipes updated'); route(); }
}
navigator.serviceWorker?.ready.then(update) ?? update();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') update(); });
