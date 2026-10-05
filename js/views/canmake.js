import { getIndex } from '../data.js';
import { allStats } from '../db.js';
import { isMain } from '../planner.js';
import { coverage } from '../pantry.js';
import { html, view, stars, setHTML, plural } from '../ui.js';
import { currentPlan, loadPantry } from '../store.js';
import { planDayPicker, assignPlanDay } from '../widgets.js';

const filters = { mains: true, favorites: false };
const GROUPS = [[0, 'You have everything'], [1, 'Missing 1 thing'], [2, 'Missing 2 things']];

export async function render() {
  const [{ pantry, catalog, have, staples }, index, stats, plan] = await Promise.all([loadPantry(), getIndex(), allStats(), currentPlan()]);
  if (!pantry.have.length) {
    return view(html`<h1>What can I make?</h1>
      <p class="lead">Tick what you have in the pantry first, then come back here.</p>
      <a class="btn primary big" href="#/pantry">Open the pantry</a>`);
  }
  const names = new Map(catalog.map(c => [c.id, c.name]));
  const rows = index
    .filter(e => !stats.get(e.id)?.excluded)
    .map(e => ({ e, s: stats.get(e.id), cov: coverage(e, have, pantry, staples) }))
    .filter(r => r.cov.using > 0 && r.cov.missing.length <= 2);

  const el = view(html`
    <div class="row between wrap">
      <h1>What can I make?</h1>
      <a class="btn" href="#/pantry">Edit pantry</a>
    </div>
    <p class="muted">From the ${plural(pantry.have.length, 'item')} in your pantry${pantry.assumeStaples ? ', plus staples' : ''}.</p>
    <div class="chips" role="group" aria-label="Filter">
      <button class="chip" data-filter="mains" aria-pressed="${filters.mains}">Dinner mains only</button>
      <button class="chip" data-filter="favorites" aria-pressed="${filters.favorites}">Favorites</button>
    </div>
    <div class="results"></div>`);

  const results = el.querySelector('.results');
  const draw = () => {
    const shown = rows.filter(r => (!filters.mains || isMain(r.e, r.s)) && (!filters.favorites || r.s?.favorite));
    const groups = GROUPS.map(([n, label]) => [label, shown.filter(r => r.cov.missing.length === n)
      // most use of the pantry first, then best rated
      .sort((a, b) => b.cov.using - a.cov.using || (b.s?.rating ?? 0) - (a.s?.rating ?? 0) || a.e.title.localeCompare(b.e.title))])
      .filter(([, group]) => group.length);
    setHTML(results, groups.length ? html`${groups.map(([label, group]) => html`<section><h2>${label} <span class="muted">(${group.length})</span></h2><ul class="recipe-list match-list">${group.map(r => html`
        <li data-id="${r.e.id}">
          <a href="#/recipe/${r.e.slug}">
            <span class="title">${r.e.title}</span>
            <span class="muted">${r.e.category} ${stars(r.s?.rating, { size: 'small' })}${r.s?.favorite ? ' ♥' : ''}
              · uses ${r.cov.using} of yours</span>
            ${r.cov.missing.length ? html`<span class="missing">Missing: ${r.cov.missing.map(id => names.get(id) ?? id).join(', ')}</span>` : ''}
          </a>
          ${planDayPicker(plan, { label: 'Plan for', recipeId: r.e.id, short: true })}
        </li>`)}</ul></section>`)}`
      : html`<p class="lead">Nothing is within two items of your pantry${filters.mains || filters.favorites ? ' with these filters' : ''}.</p>`);
  };

  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filters[chip.dataset.filter] = !filters[chip.dataset.filter];
    chip.setAttribute('aria-pressed', filters[chip.dataset.filter]);
    draw();
  });
  el.addEventListener('change', e => assignPlanDay(e, plan, e.target.closest('[data-id]')?.dataset.id));
  draw();
  return el;
}
