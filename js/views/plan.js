import { getIndex, indexById } from '../data.js';
import { allStats, getMeta, setMeta, getPlan, putPlan, updateStat } from '../db.js';
import { newPlan, fillPlan, uncounted, isoDate, addDays, DEFAULTS } from '../planner.js';
import { html, view, stars, formatDay, toast } from '../ui.js';

const MULTIPLIERS = [0.5, 1, 1.5, 2, 3];
const multLabel = m => ({ 0.5: '½×', 1.5: '1½×' })[m] ?? `${m}×`;

export async function currentPlan() {
  const id = await getMeta('currentPlan');
  return id ? getPlan(id) : null;
}
export async function settings() {
  return { ...DEFAULTS, ...(await getMeta('settings')) };
}

export async function render() {
  const [plan, byId, stats] = await Promise.all([currentPlan(), indexById(), allStats()]);
  return plan ? planView(plan, byId, stats) : startView();
}

function startView(start = isoDate(new Date())) {
  const el = view(html`
    <h1>This week's dinners</h1>
    <p class="lead">Pick seven dinners at random from your mains, favoring the ones you rate highly
      and skipping anything you've had in the last few weeks.</p>
    <form class="card stack" data-form="start">
      <label class="field">First day
        <input type="date" name="start" value="${start}" required>
      </label>
      <button class="btn primary big" type="submit">Plan my week</button>
    </form>`);
  el.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const [index, stats, cfg] = await Promise.all([getIndex(), allStats(), settings()]);
    const plan = fillPlan(newPlan(e.target.start.value, cfg.days), index, stats, cfg);
    await putPlan(plan);
    await setMeta('currentPlan', plan.id);
    rerender();
  });
  return el;
}

function planView(plan, byId, stats) {
  const pending = uncounted(plan);
  const end = plan.days.at(-1).date;
  const el = view(html`
    <div class="row between wrap">
      <h1>Dinners ${formatDay(plan.start, { month: 'short', day: 'numeric' })} – ${formatDay(end, { month: 'short', day: 'numeric' })}</h1>
      <a class="btn" href="#/shop">Shopping list</a>
    </div>
    ${pending.length ? html`
      <div class="card notice row between wrap">
        <span>${plan.accepted ? 'You changed the plan.' : 'Happy with these? Saving counts them as suggested, so they rest for a few weeks.'}</span>
        <button class="btn primary" data-action="accept">Save plan</button>
      </div>` : ''}
    <ol class="days">${plan.days.map((d, i) => dayCard(d, i, byId.get(d.recipeId), stats.get(d.recipeId)))}</ol>
    <div class="row wrap gap">
      <button class="btn" data-action="reroll-all">Swap all unlocked</button>
      <button class="btn quiet" data-action="new-plan">Start a new week</button>
    </div>`);

  el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const i = +btn.closest('[data-day]')?.dataset.day;
    const day = plan.days[i];
    const save = async p => { await putPlan(p); rerender(); };
    const refill = async which => {
      const [index, st, cfg] = await Promise.all([getIndex(), allStats(), settings()]);
      return fillPlan(plan, index, st, { ...cfg, which });
    };
    switch (btn.dataset.action) {
      case 'swap': return save(await refill([i]));
      case 'reroll-all': return save(await refill());
      case 'lock': day.locked = !day.locked; return save(plan);
      case 'skip':
        day.skip = !day.skip;
        if (day.skip) { day.recipeId = null; day.locked = false; return save(plan); }
        return save(await refill([i]));
      case 'cooked': {
        day.cooked = !day.cooked;
        // prevCooked lets an accidental tap be undone without losing the earlier date
        await updateStat(day.recipeId, s => day.cooked
          ? { timesCooked: (s.timesCooked ?? 0) + 1, lastCooked: day.date, prevCooked: s.lastCooked ?? null }
          : { timesCooked: Math.max((s.timesCooked ?? 1) - 1, 0), lastCooked: s.prevCooked ?? null });
        return save(plan);
      }
      case 'accept': {
        const today = isoDate(new Date());
        for (const id of uncounted(plan)) {
          await updateStat(id, s => ({ timesRecommended: (s.timesRecommended ?? 0) + 1, lastRecommended: today }));
        }
        plan.counted = plan.days.map(d => d.recipeId).filter(Boolean);
        plan.accepted = true;
        toast('Plan saved');
        return save(plan);
      }
      case 'new-plan':
        if (pending.length && !confirm('This plan has not been saved. Start a new week anyway?')) return;
        await setMeta('currentPlan', null);
        el.replaceWith(startView(addDays(end, 1) > isoDate(new Date()) ? addDays(end, 1) : isoDate(new Date())));
    }
  });
  el.addEventListener('change', e => {
    if (e.target.name !== 'multiplier') return;
    plan.days[+e.target.closest('[data-day]').dataset.day].multiplier = +e.target.value;
    putPlan(plan);
  });
  return el;
}

function dayCard(d, i, entry, stat) {
  const weekday = formatDay(d.date, { weekday: 'long' });
  const date = formatDay(d.date, { month: 'short', day: 'numeric' });
  if (d.skip || !entry) {
    return html`<li class="day card skip" data-day="${i}">
      <div class="day-date"><strong>${weekday}</strong> ${date}</div>
      <p class="muted">${d.skip ? 'No dinner planned (out, leftovers…)' : 'No main dishes left to choose from.'}</p>
      <div class="row wrap gap"><button class="btn" data-action="skip">${d.skip ? 'Plan a dinner' : 'Skip this day'}</button></div>
    </li>`;
  }
  return html`<li class="day card ${d.locked ? 'locked' : ''} ${d.cooked ? 'cooked' : ''}" data-day="${i}">
    <div class="day-date"><strong>${weekday}</strong> ${date}</div>
    <a class="day-title" href="#/recipe/${entry.slug}">${entry.title}</a>
    <div class="muted">${entry.category} ${stars(stat?.rating, { size: 'small' })}${stat?.favorite ? ' ♥' : ''}</div>
    <div class="row wrap gap controls">
      <button class="btn small ${d.locked ? 'on' : ''}" data-action="lock" aria-pressed="${d.locked}">${d.locked ? 'Locked' : 'Lock'}</button>
      <button class="btn small" data-action="swap" ${d.locked ? 'disabled' : ''}>Swap</button>
      <button class="btn small" data-action="skip">Skip</button>
      <label class="small-select">Make
        <select name="multiplier">${MULTIPLIERS.map(m => html`<option value="${m}" ${m === d.multiplier ? 'selected' : ''}>${multLabel(m)}</option>`)}</select>
      </label>
      <button class="btn small ${d.cooked ? 'on' : ''}" data-action="cooked" aria-pressed="${d.cooked}">${d.cooked ? 'Cooked ✓' : 'Cooked it'}</button>
    </div>
  </li>`;
}

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
