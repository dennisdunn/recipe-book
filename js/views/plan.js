import { indexById } from '../data.js';
import { allStats, setMeta, putPlan, updateStat } from '../db.js';
import { newPlan, uncounted, isoDate, addDays } from '../planner.js';
import { coverage } from '../pantry.js';
import { currentPlan, settings, saveSettings, loadPantry, fillDays } from '../store.js';
import { html, view, stars, formatDay, toast, rerender, plural } from '../ui.js';

const MULTIPLIERS = [0.5, 1, 1.5, 2, 3];
const multLabel = m => ({ 0.5: '½×', 1.5: '1½×' })[m] ?? `${m}×`;

export async function render() {
  const [plan, byId, stats, cfg, pantry] = await Promise.all([currentPlan(), indexById(), allStats(), settings(), loadPantry()]);
  return plan ? planView(plan, byId, stats, cfg, pantry) : startView(cfg, pantry);
}

const pantryToggle = (cfg, { pantry }) => html`<label class="toggle">
  <input type="checkbox" name="usePantry" ${cfg.usePantry && pantry.have.length ? 'checked' : ''} ${pantry.have.length ? '' : 'disabled'}>
  <span>Use what I have <span class="muted">(${pantry.have.length
    ? html`${plural(pantry.have.length, 'item')} in the <a href="#/pantry">pantry</a>`
    : html`the <a href="#/pantry">pantry</a> is empty`})</span></span></label>`;

async function savePantryToggle(e) {
  if (e.target.name !== 'usePantry') return false;
  await saveSettings({ usePantry: e.target.checked });
  return true;
}

function startView(cfg, pantry, start = isoDate(new Date())) {
  const el = view(html`
    <h1>This week's dinners</h1>
    <p class="lead">Pick seven dinners at random from your mains, favoring the ones you rate highly
      and skipping anything you've had in the last few weeks.</p>
    <form class="card stack" data-form="start">
      <label class="field">First day
        <input type="date" name="start" value="${start}" required>
      </label>
      ${pantryToggle(cfg, pantry)}
      <button class="btn primary big" type="submit">Plan my week</button>
    </form>
    <p><a href="#/plans">Past plans</a></p>`);
  el.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const plan = await fillDays(newPlan(e.target.start.value, cfg.days));
    await putPlan(plan);
    await setMeta('currentPlan', plan.id);
    rerender();
  });
  el.addEventListener('change', savePantryToggle);
  return el;
}

function planView(plan, byId, stats, cfg, pantry) {
  const cov = pantry.pantry.have.length ? e => coverage(e, pantry.have, pantry.pantry, pantry.staples) : () => null;
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
    <ol class="days">${plan.days.map((d, i) => dayCard(d, i, byId.get(d.recipeId), stats.get(d.recipeId), byId.has(d.recipeId) ? cov(byId.get(d.recipeId)) : null))}</ol>
    <div class="row wrap gap">
      ${pantryToggle(cfg, pantry)}
    </div>
    <div class="row wrap gap">
      <button class="btn" data-action="reroll-all">Swap all unlocked</button>
      <button class="btn quiet" data-action="new-plan">Start a new week</button>
      <a class="btn quiet" href="#/plans">Past plans</a>
    </div>`);

  el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const i = +btn.closest('[data-day]')?.dataset.day;
    const day = plan.days[i];
    const save = async p => { await putPlan(p); rerender(); };
    const refill = which => fillDays(plan, which);
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
        el.replaceWith(startView(cfg, pantry, addDays(end, 1) > isoDate(new Date()) ? addDays(end, 1) : isoDate(new Date())));
    }
  });
  el.addEventListener('change', async e => {
    if (await savePantryToggle(e)) return;
    if (e.target.name !== 'multiplier') return;
    plan.days[+e.target.closest('[data-day]').dataset.day].multiplier = +e.target.value;
    await putPlan(plan);
  });
  return el;
}

function dayCard(d, i, entry, stat, cov) {
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
    ${cov?.needed ? html`<div class="muted small">You have ${cov.using} of ${cov.needed} ingredients</div>` : ''}
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

