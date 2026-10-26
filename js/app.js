// Boot + hash router.
// Simple view (the default): #/ (home), #/choose, #/choose/tonight, #/tonight, #/dish/<slug>.
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
  [/^\/choose\/tonight$/, { render: simple.choose }, null, () => ({ target: 'tonight' })],
  [/^\/tonight$/, { render: simple.tonight }, null],
  [/^\/dish\/([a-z0-9-]+)$/, { render: simple.dish }, null, m => ({ slug: m[1] })],
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
    // the simple view gets plain words and one way out; the helper view also gets the technical message
    el = mode === 'simple'
      ? view(html`<h1>Something went wrong</h1><p class="simple-lead">Please go back to the start and try again.</p>
          <a class="btn primary huge" href="#/">Start again</a>`)
      : view(html`<h1>Something went wrong</h1><p class="lead">${err.message}</p>
          <p>If you are offline, this page may not have been saved yet.</p><a class="btn" href="#/plan">Back to the plan</a>`);
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

// The way into the helper view: press and hold the logo for 2 seconds (a ring fills while holding). Nothing on screen
// points to it, so the simple view stays simple; a plain tap still goes Home.
const HOLD_MS = 2000;
const brand = document.querySelector('.brand');
let holdTimer = null, holdStart = null, swallowClick = false;
const endHold = () => { clearTimeout(holdTimer); holdTimer = null; brand.classList.remove('holding'); };
brand.addEventListener('pointerdown', e => {
  holdStart = { x: e.clientX, y: e.clientY };
  brand.classList.add('holding');
  holdTimer = setTimeout(() => { endHold(); swallowClick = true; location.hash = '#/plan'; }, HOLD_MS);
});
brand.addEventListener('pointermove', e => { // a finger that moves is scrolling, not holding
  if (holdTimer && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 12) endHold();
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(type => brand.addEventListener(type, endHold));
brand.addEventListener('click', e => { if (swallowClick) { e.preventDefault(); swallowClick = false; } });
brand.addEventListener('contextmenu', e => e.preventDefault()); // no long-press menu on the logo

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
