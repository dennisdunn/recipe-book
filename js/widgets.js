// Small UI pieces shared by several screens (screens never import each other).
import { putPlan } from './db.js';
import { html, formatDay, toast } from './ui.js';

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
