import { putPlan } from '../db.js';
import { formatAmount } from '../units.js';
import { balanceColumns as balance, shoppingRow as itemRow } from '../widgets.js';
import { currentPlan, savePantry, shoppingFor } from '../store.js';
import { html, view, rerender } from '../ui.js';

let showStaples = false;

export async function render() {
  const plan = await currentPlan();
  const days = plan?.days.filter(d => d.recipeId && !d.skip) ?? [];
  if (!days.length) {
    return view(html`<h1>Shopping list</h1><p class="lead">Plan your week first and the list builds itself.</p>
      <a class="btn primary big" href="#/plan">Plan dinners</a>`);
  }
  // items ticked in the pantry are set aside rather than bought
  const { entries, pantry, aisles, alreadyHave } = await shoppingFor(plan);
  const staples = aisles.flatMap(a => a.items).filter(i => i.staple).length;

  const el = view(html`
    <div class="row between wrap">
      <h1>Shopping list</h1>
      <div class="row wrap gap no-print">
        <button class="btn" data-action="print">Print</button>
        <label class="toggle"><input type="checkbox" data-action="staples" ${showStaples ? 'checked' : ''}> Show staples (${staples})</label>
      </div>
    </div>
    <p class="muted">For ${entries.map(e => e.recipe.title).join(', ')}.</p>
    <form class="row gap no-print" data-form="extra">
      <input name="extra" placeholder="Add something else…" autocomplete="off" aria-label="Add an item">
      <button class="btn" type="submit">Add</button>
    </form>
    <div class="aisles"><div class="col">
    ${plan.extras.length ? html`<section class="aisle"><h2>Added by you</h2><ul class="shop">${plan.extras.map((x, i) => html`
      <li class="${plan.checked.includes(`extra:${x}`) ? 'done' : ''}">
        <label><input type="checkbox" data-key="extra:${x}" ${plan.checked.includes(`extra:${x}`) ? 'checked' : ''}>
          <span class="item-name">${x}</span></label>
        <button class="btn small quiet" data-action="remove-extra" data-index="${i}" aria-label="Remove ${x}">✕</button>
      </li>`)}</ul></section>` : ''}
    ${aisles.map(a => {
      const items = a.items.filter(i => showStaples || !i.staple);
      return items.length ? html`<section class="aisle"><h2>${a.aisle}</h2><ul class="shop">${items.map(it => itemRow(it, plan.checked.includes(it.catalogId)))}</ul></section>` : '';
    })}
    </div><div class="col"></div></div>
    ${alreadyHave.length ? html`<details class="card already no-print"><summary>Already have (${alreadyHave.length}, from your pantry)</summary>
      <ul class="shop">${alreadyHave.map(it => html`<li>
        <span><span class="item-name">${it.name}</span>
          <span class="qty">${it.amounts.map(formatAmount).join(' + ')}</span>
          <span class="from">${it.recipes.join(' · ')}</span></span>
        <button class="btn small" data-action="out-of" data-id="${it.catalogId}">I'm out</button>
      </li>`)}</ul></details>` : ''}
    <p class="muted small">≈ marks amounts that are approximate (ranges, pinches, dashes). Lines in quotes are copied
      from the recipe because the amount could not be read reliably.</p>
    <button class="btn quiet" data-action="clear">Uncheck everything</button>`);

  balance(el);

  el.addEventListener('change', async e => {
    if (e.target.dataset.action === 'staples') { showStaples = e.target.checked; return rerender(); }
    const key = e.target.dataset.key;
    if (!key) return;
    plan.checked = e.target.checked ? [...plan.checked, key] : plan.checked.filter(k => k !== key);
    e.target.closest('li').classList.toggle('done', e.target.checked);
    balance(el);
    await putPlan(plan);
  });
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const text = e.target.extra.value.trim();
    if (text && !plan.extras.includes(text)) { plan.extras.push(text); await putPlan(plan); rerender(); }
  });
  el.addEventListener('click', async e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'print') window.print();
    if (action === 'out-of') {
      pantry.have = pantry.have.filter(id => id !== e.target.closest('[data-id]').dataset.id);
      await savePantry(pantry);
      rerender();
    }
    if (action === 'clear') { plan.checked = []; await putPlan(plan); rerender(); }
    if (action === 'remove-extra') { plan.extras.splice(+e.target.closest('[data-index]').dataset.index, 1); await putPlan(plan); rerender(); }
  });
  return el;
}
