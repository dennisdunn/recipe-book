// Menu builder: one random dinner at a time, shown as the full recipe. "Add to menu" puts it on the next open day of
// the current plan; "Show another" passes it over for this menu. "Plan my week" (all seven at once) is the other way.
// Progress lives in the plan (`plan.menu`), so a menu can be left and picked up again later.
import { indexById } from '../data.js';
import { putPlan } from '../db.js';
import { nextOpenDay, uncounted } from '../planner.js';
import { recipeView } from '../recipe-view.js';
import { currentPlan, getPlan, offerFor, savePlanCounts, nextFreeStart, startMenuWeek } from '../store.js';
import { html, view, formatDay, toast, rerender, plural, appendHTML } from '../ui.js';

const weekday = iso => formatDay(iso, { weekday: 'long' });

export async function render() {
  const [plan, byId] = await Promise.all([currentPlan(), indexById()]);
  const day = plan ? nextOpenDay(plan) : -1;
  // finished menu with dinners not yet saved (counted): show it with Save; once saved, offer a new week
  if (plan?.menu && day === -1 && uncounted(plan).length) return doneView(plan, byId);
  if (!plan || day === -1) return startView(await nextFreeStart());

  plan.menu ??= { offer: null, passed: [] }; // continuing a week that has open days
  const inPlan = new Set(plan.days.map(d => d.recipeId));
  const { menu } = plan;
  let entry = menu.offer && !inPlan.has(menu.offer) && !menu.passed.includes(menu.offer) ? byId.get(menu.offer) : null;
  entry ??= await offerFor(plan, day, menu.passed);
  if (!entry && menu.passed.length) {
    menu.passed = []; // every dinner has been passed over once: go round again
    entry = await offerFor(plan, day, []);
    toast("That's every dinner; starting over");
  }
  if (menu.offer !== (entry?.id ?? null)) {
    menu.offer = entry?.id ?? null; // remember it, so a redraw or a later visit shows the same recipe
    await putPlan(plan);
  }
  if (!entry) return emptyView(plan, day);

  const chosen = plan.days.filter(d => byId.has(d.recipeId) || d.skip);
  const el = view(html`
    <div class="menu-head no-print">
      <p class="muted">Building the week of ${formatDay(plan.start, { month: 'short', day: 'numeric' })}
        · ${plural(plan.days.filter(d => byId.has(d.recipeId)).length, 'dinner')} chosen</p>
      <p class="menu-day">Dinner for <strong>${formatDay(plan.days[day].date, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>?</p>
      ${chosen.length ? html`<ol class="menu-chosen">${chosen.map(d => html`<li>
        <span class="muted">${formatDay(d.date, { weekday: 'short' })}</span>
        ${byId.has(d.recipeId) ? byId.get(d.recipeId).title : html`<span class="muted">no dinner</span>`}</li>`)}</ol>` : ''}
    </div>`);
  const recipeEl = await recipeView(entry.slug, { planPicker: false });
  el.append(recipeEl);
  appendHTML(el, html`
    <div class="menu-bar no-print">
      <button class="btn primary big" data-action="add">Add to menu</button>
      <button class="btn big" data-action="another">Show another</button>
      <button class="btn quiet" data-action="skip-day">No dinner ${weekday(plan.days[day].date)}</button>
      <a class="btn quiet" href="#/plan">Done for now</a>
    </div>`);
  el.cleanup = () => recipeEl.cleanup?.();

  el.addEventListener('click', async e => {
    const action = e.target.closest('.menu-bar [data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'add') {
      Object.assign(plan.days[day], { recipeId: entry.id, locked: true, skip: false, cooked: false });
      menu.offer = null;
      toast(`Added for ${weekday(plan.days[day].date)}`, {
        label: 'Undo',
        run: async () => {
          const p = await getPlan(plan.id);
          Object.assign(p.days[day], { recipeId: null, locked: false });
          p.menu = { ...p.menu, offer: entry.id };
          await putPlan(p);
          rerender({ top: true });
        },
      });
    }
    if (action === 'another') { menu.passed.push(entry.id); menu.offer = null; }
    if (action === 'skip-day') plan.days[day].skip = true; // the same recipe is then offered for the next day
    await putPlan(plan);
    rerender({ top: true });
  });
  return el;
}

function startView(start) {
  const el = view(html`
    <h1>Build a menu</h1>
    <p class="lead">See one dinner at a time, as the full recipe. Add it to the menu or ask for another,
      until the week is full.</p>
    <form class="card stack">
      <label class="field">First day <input type="date" name="start" value="${start}" required></label>
      <button class="btn primary big" type="submit">Start</button>
    </form>
    <p class="muted">Prefer all seven at once? <a href="#/plan">Plan my week</a> picks them at random.</p>`);
  el.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    if (await startMenuWeek(e.target.start.value)) rerender({ top: true });
  });
  return el;
}

function doneView(plan, byId) {
  const el = view(html`
    <h1>Your menu is ready</h1>
    <ol class="menu-chosen big">${plan.days.map(d => {
      const e = byId.get(d.recipeId);
      return html`<li><span class="muted">${formatDay(d.date, { weekday: 'short' })}</span>
        ${e ? html`<a href="#/recipe/${e.slug}">${e.title}</a>` : html`<span class="muted">no dinner</span>`}</li>`;
    })}</ol>
    <p class="muted">Saving counts these as suggested, so random picks give them a rest for a few weeks.</p>
    <div class="row wrap gap">
      <button class="btn primary big" data-action="save">Save menu</button>
      <a class="btn big" href="#/shop">Shopping list</a>
      <a class="btn quiet" href="#/plan">See it in the plan</a>
    </div>`);
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-action]')?.dataset.action !== 'save') return;
    await putPlan(await savePlanCounts(plan));
    toast('Menu saved');
    location.hash = '#/plan';
  });
  return el;
}

function emptyView(plan, day) {
  const el = view(html`
    <h1>No more dinners to offer</h1>
    <p class="lead">Every main dish is already in this menu or marked "never suggest".</p>
    <div class="row wrap gap">
      <button class="btn" data-action="skip-day">No dinner ${weekday(plan.days[day].date)}</button>
      <a class="btn" href="#/plan">Go to the plan</a>
    </div>`);
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-action]')?.dataset.action !== 'skip-day') return;
    plan.days[day].skip = true;
    await putPlan(plan);
    rerender({ top: true });
  });
  return el;
}
