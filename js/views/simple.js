// Simple view: the default, for someone who needs one clear next step. Few choices per screen, always in the same
// place; plain words (weekday names, no dates or jargon); no pop-up questions, no timed messages. Removing a chosen
// dinner only empties that day. Screens: Home (#/), Choose (#/choose, #/choose/tonight), Tonight (#/tonight) and
// a recipe (#/dish/<slug>). Everything else is the helper view.
import { getIndex, getRecipe, indexById } from '../data.js';
import { putPlan } from '../db.js';
import { recipeLines } from '../recipe-view.js';
import { ensureSimplePlan, simpleWeek, offerFor, savePlanCounts, loadPantry } from '../store.js';
import { html, view, formatDay, rerender, plural } from '../ui.js';

const weekday = iso => formatDay(iso, { weekday: 'long' });

/** Times are shown only once every dinner main has a reviewed one, so they never appear on some recipes and not others. */
async function timesReady() {
  const mains = (await getIndex()).filter(e => e.tags.includes('main'));
  return mains.length > 0 && mains.every(e => e.time?.reviewed);
}

const dishLink = e => html`<a href="#/dish/${e.slug}">${e.title}</a>`;

/** The week's days; chosen dinners link to their recipe, and with `remove` each gets a Remove button. */
function weekList(days, byId, { today, highlight, remove = false } = {}) {
  return html`<ul class="simple-week ${remove ? 'editable' : ''}">${days.map(d => {
    const e = byId.get(d.recipeId);
    const cls = [highlight != null && d.index === highlight ? 'new' : '', d.date === today ? 'today' : ''].join(' ');
    return html`<li class="${cls}"><span class="wk-day">${weekday(d.date)}</span>
      <span>${e ? dishLink(e) : html`<span class="muted">${d.skip ? 'No dinner' : 'Not chosen yet'}</span>`}</span>
      ${remove ? (e ? html`<button class="btn small" data-remove="${d.index}" aria-label="Remove ${e.title} from ${weekday(d.date)}">Remove</button>` : html`<span></span>`) : ''}
    </li>`;
  })}</ul>`;
}

// ---- Home: tonight first, then the week ----
export async function home() {
  const [{ today, dates, days }, byId] = await Promise.all([simpleWeek(), indexById()]);
  // before any dinner is chosen there may be no plan yet: show the week's dates as open days
  const week = days.length ? days : dates.map(date => ({ date, recipeId: null, skip: false }));
  const tonightDay = week.find(d => d.date === today && !d.skip);
  const tonight = byId.get(tonightDay?.recipeId);
  const nextOpen = week.find(d => !d.recipeId && !d.skip);
  const showTime = tonight && await timesReady();

  // Tonight: cook it, or choose it. Week: choose the next one (unless that is tonight), or change them.
  const tonightButton = tonight ? html`<a class="btn primary huge" href="#/tonight">Show me how to make it</a>`
    : tonightDay ? html`<a class="btn primary huge" href="#/choose/tonight">Choose tonight's dinner</a>` : '';
  const weekStyle = tonightButton ? 'btn huge' : 'btn primary huge';
  const weekButton = nextOpen && nextOpen === tonightDay ? ''
    : nextOpen ? html`<a class="${weekStyle}" href="#/choose">${week.some(d => byId.has(d.recipeId)) ? 'Choose the next dinner' : 'Choose dinners'}</a>`
    : html`<a class="${weekStyle}" href="#/choose">Change dinners</a>`;

  return view(html`
    <h1>Tonight</h1>
    ${tonight ? html`<div class="tonight-card">
        <p class="tonight-title">${dishLink(tonight)}</p>
        ${showTime && tonight.time ? html`<p class="simple-time">${tonight.time.text}</p>` : ''}
      </div>`
      : html`<p class="simple-lead">${tonightDay ? 'Nothing is chosen for tonight yet.' : 'No dinner is planned for tonight.'}</p>`}
    ${tonightButton}
    <h2 class="simple-section">${dates.includes(today) ? 'This week' : `From ${weekday(dates[0])}`}</h2>
    ${weekList(week, byId, { today })}
    ${weekButton}
    <p class="helper-link"><a href="#/plan">Helper</a></p>`);
}

// ---- Choose: one dinner, two buttons; chosen dinners can be removed ----
export async function choose({ target } = {}) {
  const [{ today, plan, days }, byId] = await Promise.all([ensureSimplePlan(), indexById()]);
  plan.menu ??= { offer: null, passed: [] };
  const menu = plan.menu;
  const forTonight = target === 'tonight';
  const isOpen = d => !d.recipeId && !d.skip;
  const next = (forTonight && days.find(d => d.date === today && isOpen(d))) || days.find(isOpen);

  const onRemove = async e => {
    const i = e.target.closest('[data-remove]')?.dataset.remove;
    if (i === undefined) return false;
    Object.assign(plan.days[+i], { recipeId: null, locked: false, cooked: false }); // the day opens up; nothing is deleted
    if (menu.lastAdded === +i) menu.lastAdded = null;
    await putPlan(plan);
    rerender({ top: true });
    return true;
  };

  if (!next) {
    const el = view(html`
      <h1>All done!</h1>
      <p class="simple-lead">Your ${plural(days.filter(d => byId.has(d.recipeId)).length, 'dinner')} are chosen.
        To change one, remove it and choose again.</p>
      ${weekList(days, byId, { highlight: menu.lastAdded, today, remove: true })}
      <a class="btn primary huge" href="#/">Done</a>`);
    el.addEventListener('click', onRemove);
    return el;
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

  const el = view(html`
    <p class="simple-step">${next.date === today ? "Tonight's dinner" : `Dinner ${days.indexOf(next) + 1} of ${days.length}`}
      · <strong>${weekday(next.date)}</strong></p>
    ${!forTonight && chosen.length ? weekList(chosen, byId, { highlight: menu.lastAdded, today, remove: true }) : ''}
    <article class="simple-recipe">
      <h1>${dishLink(entry)}</h1>
      ${showTime && recipe.time ? html`<p class="simple-time">${recipe.time.text}</p>` : ''}
      <h2>What's in it</h2>
      <ul class="simple-ingredients">${what.map(n => html`<li>${n}</li>`)}</ul>
    </article>
    <div class="simple-bar">
      <button class="btn primary huge" data-action="yes">Yes, add it</button>
      <button class="btn huge" data-action="another">Show me another</button>
    </div>`);

  el.addEventListener('click', async e => {
    if (await onRemove(e)) return;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'yes') {
      Object.assign(plan.days[next.index], { recipeId: entry.id, locked: true, skip: false, cooked: false });
      menu.lastAdded = next.index;
      menu.offer = null;
      await savePlanCounts(plan); // each chosen dinner counts as suggested right away, so it rests in later weeks
    } else {
      menu.passed.push(entry.id);
      menu.offer = null;
    }
    await putPlan(plan);
    if (action === 'yes' && forTonight) location.hash = '#/'; // tonight is set: back to Home to cook it
    else rerender({ top: true });
  });
  return el;
}

/** The whole recipe in large type (Tonight and the recipe screen). */
function fullRecipe(recipe, label, showTime) {
  return html`
    <article class="simple-recipe cook">
      ${label ? html`<p class="simple-step">${label}</p>` : ''}
      <h1>${recipe.title}</h1>
      ${showTime && recipe.time ? html`<p class="simple-time">${recipe.time.text}</p>` : ''}
      <h2>You will need</h2>
      ${recipeLines(recipe.ingredients, l => l.raw)}
      <h2>How to make it</h2>
      ${recipe.steps.length ? recipeLines(recipe.steps, s => s.text, { ordered: true })
        : html`<p>This recipe has no written steps.</p>`}
    </article>`;
}

// ---- Tonight: the full recipe, large, with the screen kept awake ----
export async function tonight() {
  const [{ today, days }, byId] = await Promise.all([simpleWeek(), indexById()]);
  const day = days.find(d => d.date === today && byId.has(d.recipeId));
  if (!day) {
    return view(html`<h1>No dinner tonight</h1>
      <p class="simple-lead">Nothing is chosen for tonight yet.</p>
      ${days.some(d => d.date === today && !d.skip)
        ? html`<a class="btn primary huge" href="#/choose/tonight">Choose tonight's dinner</a>`
        : html`<a class="btn primary huge" href="#/">Home</a>`}`);
  }
  const [recipe, showTime] = await Promise.all([getRecipe(byId.get(day.recipeId).slug), timesReady()]);
  const el = view(fullRecipe(recipe, "Tonight's dinner", showTime));

  // keep the screen on while cooking, without a button for it
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); };
  keepAwake();
  document.addEventListener('visibilitychange', onVisible);
  el.cleanup = () => { lock?.release(); document.removeEventListener('visibilitychange', onVisible); };
  return el;
}

// ---- A recipe, to look at: the full recipe and one Back button ----
export async function dish({ slug }) {
  let recipe;
  try { recipe = await getRecipe(slug); } catch {
    return view(html`<h1>That recipe is missing</h1><a class="btn primary huge" href="#/">Home</a>`);
  }
  const el = view(html`${fullRecipe(recipe, '', await timesReady())}
    <a class="btn primary huge back" href="#/" data-action="back">Back</a>`);
  el.addEventListener('click', e => {
    if (!e.target.closest('[data-action=back]') || history.length < 2) return; // opened directly: Back goes Home
    e.preventDefault();
    history.back();
  });
  return el;
}
