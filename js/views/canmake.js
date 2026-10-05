import { getIndex } from '../data.js';
import { allStats, putPlan } from '../db.js';
import { isMain } from '../planner.js';
import { coverage } from '../pantry.js';
import { html, view, stars, formatDay, toast } from '../ui.js';
import { currentPlan, loadPantry } from '../store.js';

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
    <p class="muted">From the ${pantry.have.length} item${pantry.have.length === 1 ? '' : 's'} in your pantry${pantry.assumeStaples ? ', plus staples' : ''}.</p>
    <div class="chips" role="group" aria-label="Filter">
      <button class="chip" data-filter="mains" aria-pressed="${filters.mains}">Dinner mains only</button>
      <button class="chip" data-filter="favorites" aria-pressed="${filters.favorites}">Favorites</button>
    </div>
    <div class="results"></div>`);

  const results = el.querySelector('.results');
  const draw = () => {
    const shown = rows.filter(r => (!filters.mains || isMain(r.e, r.s)) && (!filters.favorites || r.s?.favorite));
    results.innerHTML = GROUPS.map(([n, label]) => {
      const group = shown.filter(r => r.cov.missing.length === n)
        // most use of the pantry first, then best rated
        .sort((a, b) => b.cov.using - a.cov.using || (b.s?.rating ?? 0) - (a.s?.rating ?? 0) || a.e.title.localeCompare(b.e.title));
      if (!group.length) return '';
      return html`<section><h2>${label} <span class="muted">(${group.length})</span></h2><ul class="recipe-list match-list">${group.map(r => html`
        <li data-id="${r.e.id}">
          <a href="#/recipe/${r.e.slug}">
            <span class="title">${r.e.title}</span>
            <span class="muted">${r.e.category} ${stars(r.s?.rating, { size: 'small' })}${r.s?.favorite ? ' ♥' : ''}
              · uses ${r.cov.using} of yours</span>
            ${r.cov.missing.length ? html`<span class="missing">Missing: ${r.cov.missing.map(id => names.get(id) ?? id).join(', ')}</span>` : ''}
          </a>
          ${plan ? html`<label class="small-select">Plan for
            <select name="plan-day"><option value="">…</option>${plan.days.map((d, i) =>
              html`<option value="${i}">${formatDay(d.date, { weekday: 'short' })}</option>`)}</select></label>` : ''}
        </li>`)}</ul></section>`.__html;
    }).join('') || html`<p class="lead">Nothing is within two items of your pantry${filters.mains || filters.favorites ? ' with these filters' : ''}.</p>`.__html;
  };

  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filters[chip.dataset.filter] = !filters[chip.dataset.filter];
    chip.setAttribute('aria-pressed', filters[chip.dataset.filter]);
    draw();
  });
  el.addEventListener('change', async e => {
    if (e.target.name !== 'plan-day' || e.target.value === '') return;
    const day = plan.days[+e.target.value];
    Object.assign(day, { recipeId: e.target.closest('[data-id]').dataset.id, locked: true, skip: false, cooked: false });
    await putPlan(plan);
    toast(`Planned for ${formatDay(day.date, { weekday: 'long' })}`);
    e.target.value = '';
  });
  draw();
  return el;
}
