// Simple view: the default, for someone who needs one clear next step. At most two choices per screen, always in the
// same place; plain words (weekday names, no dates or jargon); nothing that deletes, no pop-up questions, no timed
// messages. Three screens: Home (#/), Choose (#/choose) and Tonight (#/tonight). Everything else is the helper view.
import { getIndex, getRecipe, indexById } from '../data.js';
import { putPlan } from '../db.js';
import { recipeLines } from '../recipe-view.js';
import { ensureSimplePlan, simpleWeek, offerFor, savePlanCounts, loadPantry } from '../store.js';
import { html, view, formatDay, rerender, plural } from '../ui.js';

const weekday = iso => formatDay(iso, { weekday: 'long' });
const span = dates => (dates.length === 1 ? weekday(dates[0]) : `${weekday(dates[0])} to ${weekday(dates.at(-1))}`);

/** Times are shown only once every dinner main has a reviewed one, so they never appear on some recipes and not others. */
async function timesReady() {
  const mains = (await getIndex()).filter(e => e.tags.includes('main'));
  return mains.length > 0 && mains.every(e => e.time?.reviewed);
}

function weekList(days, byId, { today, highlight } = {}) {
  return html`<ul class="simple-week">${days.map(d => {
    const e = byId.get(d.recipeId);
    const cls = [d.index === highlight ? 'new' : '', d.date === today ? 'today' : ''].join(' ');
    return html`<li class="${cls}"><span class="wk-day">${weekday(d.date)}</span>
      <span>${e ? e.title : d.skip ? 'No dinner' : '—'}</span></li>`;
  })}</ul>`;
}

// ---- Home: one big button that depends on where things stand ----
export async function home() {
  const [{ today, dates, plan, days }, byId] = await Promise.all([simpleWeek(), indexById()]);
  const chosen = days.filter(d => byId.has(d.recipeId));
  const open = days.filter(d => !d.recipeId && !d.skip);
  const tonight = days.find(d => d.date === today && byId.has(d.recipeId));
  const helper = html`<p class="helper-link"><a href="#/plan">Helper</a></p>`;

  if (!plan || chosen.length === 0) {
    return view(html`
      <h1>Let's choose dinners</h1>
      <p class="simple-lead">${plural(dates.length, 'dinner')} for ${span(dates)}.</p>
      <a class="btn primary huge" href="#/choose">Choose dinners</a>
      ${helper}`);
  }
  if (open.length) {
    return view(html`
      <h1>Choosing dinners</h1>
      <p class="simple-lead">You have chosen ${chosen.length} of ${days.length}.</p>
      ${weekList(days, byId, { today })}
      <a class="btn primary huge" href="#/choose">Choose the next dinner</a>
      ${helper}`);
  }
  if (tonight) {
    const e = byId.get(tonight.recipeId);
    const showTime = await timesReady();
    return view(html`
      <h1>Tonight's dinner</h1>
      <div class="tonight-card">
        <p class="tonight-title">${e.title}</p>
        ${showTime && e.time ? html`<p class="simple-time">${e.time.text}</p>` : ''}
      </div>
      <a class="btn primary huge" href="#/tonight">Show me how to make it</a>
      <h2>This week</h2>
      ${weekList(days, byId, { today })}
      ${helper}`);
  }
  return view(html`
    <h1>Dinners are chosen</h1>
    <p class="simple-lead">${days.some(d => d.date === today) ? 'No dinner is planned for tonight.' : `Your dinners start ${weekday(days[0].date)}.`}</p>
    ${weekList(days, byId, { today })}
    ${helper}`);
}

// ---- Choose: one dinner, two buttons ----
export async function choose() {
  const [{ plan, days }, byId] = await Promise.all([ensureSimplePlan(), indexById()]);
  plan.menu ??= { offer: null, passed: [] };
  const menu = plan.menu;
  const next = days.find(d => !d.recipeId && !d.skip);

  if (!next) {
    return view(html`
      <h1>All done!</h1>
      <p class="simple-lead">Your ${plural(days.filter(d => byId.has(d.recipeId)).length, 'dinner')} are chosen.</p>
      ${weekList(days, byId, { highlight: menu.lastAdded })}
      <a class="btn primary huge" href="#/">Done</a>`);
  }

  const inPlan = new Set(plan.days.map(d => d.recipeId));
  let entry = menu.offer && !inPlan.has(menu.offer) && !menu.passed.includes(menu.offer) ? byId.get(menu.offer) : null;
  entry ??= await offerFor(plan, next.index, menu.passed);
  if (!entry && menu.passed.length) {
    menu.passed = []; // every dinner has been seen: go round again, without asking
    entry = await offerFor(plan, next.index, []);
  }
  if (!entry) {
    return view(html`<h1>No more dinners to choose from</h1>
      <p class="simple-lead">Please ask your helper to add some.</p>
      <a class="btn primary huge" href="#/">Home</a>`);
  }
  if (menu.offer !== entry.id) { menu.offer = entry.id; await putPlan(plan); }

  const [recipe, { catalog, staples }, showTime] = await Promise.all([getRecipe(entry.slug), loadPantry(), timesReady()]);
  // what's in it: the main ingredients by name, in recipe order, without amounts, staples or optional extras
  const names = new Map(catalog.map(c => [c.id, c.name]));
  const what = [...new Set(recipe.ingredients
    .filter(i => i.catalogId && !i.optional && i.shop !== false && !staples.has(i.catalogId)).map(i => i.catalogId))]
    .map(id => names.get(id));
  const chosen = days.filter(d => byId.has(d.recipeId) || d.skip);
  const number = days.indexOf(next) + 1;

  const el = view(html`
    <p class="simple-step">Dinner ${number} of ${days.length} · <strong>${weekday(next.date)}</strong></p>
    ${chosen.length ? weekList(chosen, byId, { highlight: menu.lastAdded }) : ''}
    <article class="simple-recipe">
      <h1>${recipe.title}</h1>
      ${showTime && recipe.time ? html`<p class="simple-time">${recipe.time.text}</p>` : ''}
      <h2>What's in it</h2>
      <ul class="simple-ingredients">${what.map(n => html`<li>${n}</li>`)}</ul>
    </article>
    <div class="simple-bar">
      <button class="btn primary huge" data-action="yes">Yes, add it</button>
      <button class="btn huge" data-action="another">Show me another</button>
    </div>`);

  el.addEventListener('click', async e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'yes') {
      Object.assign(plan.days[next.index], { recipeId: entry.id, locked: true, skip: false, cooked: false });
      menu.lastAdded = next.index;
      menu.offer = null;
      // the last one: count the week's dinners as suggested (what "Save plan" does), with no extra step
      if (!days.some(d => d !== next && !d.recipeId && !d.skip)) await savePlanCounts(plan);
    } else {
      menu.passed.push(entry.id);
      menu.offer = null;
    }
    await putPlan(plan);
    rerender({ top: true });
  });
  return el;
}

// ---- Tonight: the full recipe, large, nothing else to press ----
export async function tonight() {
  const [{ today, days }, byId] = await Promise.all([simpleWeek(), indexById()]);
  const day = days.find(d => d.date === today && byId.has(d.recipeId));
  if (!day) {
    return view(html`<h1>No dinner tonight</h1>
      <p class="simple-lead">There is no dinner planned for tonight.</p>
      <a class="btn primary huge" href="#/">Home</a>`);
  }
  const recipe = await getRecipe(byId.get(day.recipeId).slug);
  const showTime = await timesReady();
  const el = view(html`
    <article class="simple-recipe cook">
      <p class="simple-step">Tonight's dinner</p>
      <h1>${recipe.title}</h1>
      ${showTime && recipe.time ? html`<p class="simple-time">${recipe.time.text}</p>` : ''}
      <h2>You will need</h2>
      ${recipeLines(recipe.ingredients, l => l.raw)}
      <h2>How to make it</h2>
      ${recipe.steps.length ? recipeLines(recipe.steps, s => s.text, { ordered: true })
        : html`<p>This recipe has no written steps.</p>`}
    </article>`);

  // keep the screen on while cooking, without a button for it
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); };
  keepAwake();
  document.addEventListener('visibilitychange', onVisible);
  el.cleanup = () => { lock?.release(); document.removeEventListener('visibilitychange', onVisible); };
  return el;
}
