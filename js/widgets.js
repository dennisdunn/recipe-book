// Small UI pieces shared by several screens (screens never import each other).
import { putPlan } from './db.js';
import { html, formatDay, toast } from './ui.js';
import { formatAmount } from './units.js';

/** A day menu for putting a recipe into the current plan. Handle its change event with assignPlanDay(). */
export function planDayPicker(plan, { label = 'Put in plan', recipeId, short = false } = {}) {
  if (!plan) return '';
  return html`<label class="small-select">${label}
    <select name="plan-day"><option value="">${short ? '…' : 'Choose a day…'}</option>${plan.days.map((d, i) =>
      html`<option value="${i}">${formatDay(d.date, short ? { weekday: 'short' } : undefined)}${
        d.recipeId === recipeId ? ' (already)' : ''}</option>`)}</select></label>`;
}

/** If the change came from a planDayPicker, put the recipe on that day (locked) and save. Returns true if handled. */
export async function assignPlanDay(event, plan, recipeId) {
  const select = event.target;
  if (select.name !== 'plan-day' || select.value === '' || !recipeId) return false;
  const day = plan.days[+select.value];
  Object.assign(day, { recipeId, locked: true, skip: false, cooked: false });
  await putPlan(plan);
  toast(`Planned for ${formatDay(day.date, { weekday: 'long' })}`);
  select.value = '';
  return true;
}

// Two explicit columns for printing: Safari ignores CSS columns on paper. Aisles keep their order (on screen the
// columns simply stack) and are split where the items that will print (the unticked ones) are most even.
export function balanceColumns(el) {
  const [left, right] = el.querySelectorAll('.aisles > .col');
  const sections = [...el.querySelectorAll('.aisle')];
  const weights = sections.map(s => {
    const open = s.querySelectorAll('li:not(.done)');
    return open.length ? open.length + 1.5 + s.querySelectorAll('li:not(.done) .raw').length * 0.7 : 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let split = 0, best = Infinity, before = 0;
  weights.concat(0).forEach((w, i) => {
    const longest = Math.max(before, total - before);
    if (longest < best) { best = longest; split = i; }
    before += w;
  });
  sections.forEach((s, i) => (i < split ? left : right).append(s));
}

/** One shopping-list item: name, amount, notes and the recipes it is for, with a checkbox. */
export function shoppingRow(it, checked) {
  const qty = it.amounts.map(formatAmount).join(' + ');
  return html`<li class="${checked ? 'done' : ''}">
    <label>
      <input type="checkbox" data-key="${it.catalogId}" ${checked ? 'checked' : ''}>
      <span>
        <span class="item-name">${it.name}</span>
        ${qty ? html`<span class="qty">${it.approximate ? '≈ ' : ''}${qty}</span>` : ''}
        ${it.toTaste && !qty ? html`<span class="qty muted">to taste</span>` : ''}
        ${it.optional ? html`<span class="tag">optional</span>` : ''}
        ${it.rawNotes.map(n => html`<span class="raw">“${n.raw}”</span>`)}
        <span class="from">${it.recipes.join(' · ')}</span>
      </span>
    </label>
  </li>`;
}
