import { getCatalog, indexById, getRecipe } from '../data.js';
import { putPlan } from '../db.js';
import { buildShoppingList } from '../shopping.js';
import { formatAmount } from '../units.js';
import { html, view } from '../ui.js';
import { currentPlan } from './plan.js';

let showStaples = false;

export async function render() {
  const plan = await currentPlan();
  const days = plan?.days.filter(d => d.recipeId && !d.skip) ?? [];
  if (!days.length) {
    return view(html`<h1>Shopping list</h1><p class="lead">Plan your week first and the list builds itself.</p>
      <a class="btn primary big" href="#/">Plan dinners</a>`);
  }
  const byId = await indexById();
  const entries = await Promise.all(days.map(async d => ({ recipe: await getRecipe(byId.get(d.recipeId).slug), multiplier: d.multiplier })));
  const aisles = buildShoppingList(entries, await getCatalog());
  plan.checked ??= [];
  plan.extras ??= [];
  const staples = aisles.flatMap(a => a.items).filter(i => i.staple).length;

  const el = view(html`
    <div class="row between wrap">
      <h1>Shopping list</h1>
      <label class="toggle"><input type="checkbox" data-action="staples" ${showStaples ? 'checked' : ''}> Show staples (${staples})</label>
    </div>
    <p class="muted">For ${entries.map(e => e.recipe.title).join(', ')}.</p>
    <form class="row gap" data-form="extra">
      <input name="extra" placeholder="Add something else…" autocomplete="off" aria-label="Add an item">
      <button class="btn" type="submit">Add</button>
    </form>
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
    <p class="muted small">≈ marks amounts that are approximate (ranges, pinches, dashes). Lines in quotes are copied
      from the recipe because the amount could not be read reliably.</p>
    <button class="btn quiet" data-action="clear">Uncheck everything</button>`);

  el.addEventListener('change', e => {
    if (e.target.dataset.action === 'staples') { showStaples = e.target.checked; return rerender(); }
    const key = e.target.dataset.key;
    if (!key) return;
    plan.checked = e.target.checked ? [...plan.checked, key] : plan.checked.filter(k => k !== key);
    e.target.closest('li').classList.toggle('done', e.target.checked);
    putPlan(plan);
  });
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const text = e.target.extra.value.trim();
    if (text && !plan.extras.includes(text)) { plan.extras.push(text); await putPlan(plan); rerender(); }
  });
  el.addEventListener('click', async e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear') { plan.checked = []; await putPlan(plan); rerender(); }
    if (action === 'remove-extra') { plan.extras.splice(+e.target.closest('[data-index]').dataset.index, 1); await putPlan(plan); rerender(); }
  });
  return el;
}

function itemRow(it, checked) {
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

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
