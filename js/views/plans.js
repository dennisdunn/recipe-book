import { indexById } from '../data.js';
import { allPlans, getPlan, putPlan, deletePlan, getMeta, setMeta } from '../db.js';
import { newPlan, isoDate, addDays } from '../planner.js';
import { html, view, formatDay, toast } from '../ui.js';
import { fillDays } from './plan.js';

const short = { month: 'short', day: 'numeric' };

export async function render() {
  const [plans, byId, currentId] = await Promise.all([allPlans(), indexById(), getMeta('currentPlan')]);
  plans.sort((a, b) => b.start.localeCompare(a.start));
  // default for Repeat: the day after the latest plan ends, so it doesn't collide with an existing week
  const today = isoDate(new Date());
  const nextFree = plans.length ? addDays(plans.reduce((m, p) => (p.days.at(-1).date > m ? p.days.at(-1).date : m), ''), 1) : today;
  const repeatStart = nextFree > today ? nextFree : today;

  const el = view(html`
    <div class="row between wrap">
      <h1>Past plans</h1>
      <a class="btn" href="#/">This week</a>
    </div>
    ${plans.length ? '' : html`<p class="lead">No plans yet. Plan a week and it will be kept here.</p>`}
    <ol class="plan-history">${plans.map(p => html`
      <li class="card ${p.id === currentId ? 'current' : ''}" data-id="${p.id}">
        <div class="row between wrap">
          <h2>${formatDay(p.start, short)} – ${formatDay(p.days.at(-1).date, short)}</h2>
          <span class="muted">${p.id === currentId ? html`<span class="tag">Current</span> ` : ''}${p.accepted ? 'Saved' : 'Draft'}</span>
        </div>
        <ul class="plan-days">${p.days.map(d => {
          const e = byId.get(d.recipeId);
          return html`<li><span class="muted">${formatDay(d.date, { weekday: 'short' })}</span>
            ${d.skip ? html`<span class="muted">no dinner</span>`
              : e ? html`<a href="#/recipe/${e.slug}">${e.title}</a>${d.cooked ? html` <span class="cooked-mark">✓ cooked</span>` : ''}`
              : html`<span class="muted">${d.recipeId ? 'recipe no longer in the book' : 'nothing chosen'}</span>`}</li>`;
        })}</ul>
        <div class="row wrap gap">
          ${p.id === currentId ? '' : html`<button class="btn small" data-action="open">Open</button>`}
          <form class="row wrap gap repeat" data-action="repeat">
            <label class="small-select">Repeat starting <input type="date" name="start" value="${repeatStart}" required></label>
            <button class="btn small" type="submit">Repeat</button>
          </form>
          <button class="btn small quiet" data-action="delete">Delete</button>
        </div>
      </li>`)}</ol>`);

  el.addEventListener('click', async e => {
    const action = e.target.closest('button[data-action]')?.dataset.action;
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!action || !id) return;
    if (action === 'open') {
      await setMeta('currentPlan', id);
      location.hash = '#/';
    }
    if (action === 'delete') {
      const plan = await getPlan(id);
      const wasCurrent = id === currentId;
      await deletePlan(id);
      if (wasCurrent) await setMeta('currentPlan', null);
      rerender();
      toast(`Deleted the week of ${formatDay(plan.start, short)}`, {
        label: 'Undo',
        run: async () => { await putPlan(plan); if (wasCurrent) await setMeta('currentPlan', id); rerender(); },
      });
    }
  });

  // Repeat: same dinners on a new week, locked so "Swap all" keeps them; days whose recipe is gone get a fresh pick.
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const source = await getPlan(e.target.closest('[data-id]').dataset.id);
    const start = e.target.start.value;
    const existing = await getPlan(start);
    if (existing && !confirm(`There is already a plan starting ${formatDay(start, short)}. Replace it?`)) return;
    let plan = newPlan(start, source.days.length);
    plan.days.forEach((d, i) => {
      const from = source.days[i];
      const ok = byId.has(from.recipeId);
      Object.assign(d, { recipeId: ok ? from.recipeId : null, locked: ok, skip: from.skip, multiplier: from.multiplier });
    });
    const gaps = plan.days.map((d, i) => (!d.recipeId && !d.skip ? i : -1)).filter(i => i >= 0);
    if (gaps.length) plan = await fillDays(plan, gaps);
    await putPlan(plan);
    await setMeta('currentPlan', plan.id);
    toast(`Planned the week of ${formatDay(start, short)}`);
    location.hash = '#/';
  });
  return el;
}

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
