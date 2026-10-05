import { getIndex, getCategories } from '../data.js';
import { allStats } from '../db.js';
import { isMain } from '../planner.js';
import { html, view, stars, setHTML, plural } from '../ui.js';

// kept while the app is open so going back to the list restores the search
const state = { q: '', filter: 'all', category: '' };

const FILTERS = [['all', 'All'], ['main', 'Dinner mains'], ['favorite', 'Favorites'], ['rated', 'Rated'], ['keto', 'Keto']];

export async function render() {
  const [index, categories, stats] = await Promise.all([getIndex(), getCategories(), allStats()]);
  const el = view(html`
    <h1>Recipes</h1>
    <div class="search stack">
      <input type="search" name="q" value="${state.q}" placeholder="Search titles and ingredients" aria-label="Search recipes" autocomplete="off">
      <div class="row wrap gap">
        <div class="chips" role="group" aria-label="Filter">${FILTERS.map(([k, label]) =>
          html`<button class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${label}</button>`)}</div>
        <select name="category" aria-label="Category">
          <option value="">All categories</option>
          ${categories.map(c => html`<option value="${c.slug}" ${state.category === c.slug ? 'selected' : ''}>${c.name} (${c.count})</option>`)}
        </select>
      </div>
    </div>
    <p class="muted count" aria-live="polite"></p>
    <ul class="recipe-list"></ul>`);

  const list = el.querySelector('.recipe-list');
  const count = el.querySelector('.count');
  const update = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = index.filter(e => {
      const s = stats.get(e.id);
      if (state.category && e.categorySlug !== state.category) return false;
      if (state.filter === 'main' && !isMain(e, s)) return false;
      if (state.filter === 'favorite' && !s?.favorite) return false;
      if (state.filter === 'rated' && !s?.rating) return false;
      if (state.filter === 'keto' && !e.tags.includes('keto')) return false;
      const hay = `${e.title} ${e.category} ${e.ingredients.join(' ')}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    if (state.filter === 'rated') rows.sort((a, b) => (stats.get(b.id).rating - stats.get(a.id).rating) || a.title.localeCompare(b.title));
    count.textContent = plural(rows.length, 'recipe');
    setHTML(list, html`${rows.map(e => {
      const s = stats.get(e.id);
      return html`<li><a href="#/recipe/${e.slug}">
        <span class="title">${e.title}</span>
        <span class="muted">${e.category}${e.subcategory && e.subcategory !== 'KETO RECIPES' ? ` · ${e.subcategory}` : ''}
          ${stars(s?.rating, { size: 'small' })}${s?.favorite ? ' ♥' : ''}</span>
      </a></li>`;
    })}`);
  };
  el.addEventListener('input', e => {
    if (e.target.name === 'q') { state.q = e.target.value; update(); }
  });
  el.addEventListener('change', e => {
    if (e.target.name === 'category') { state.category = e.target.value; update(); }
  });
  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    el.querySelectorAll('[data-filter]').forEach(c => c.setAttribute('aria-pressed', c === chip));
    update();
  });
  update();
  return el;
}
