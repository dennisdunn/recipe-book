import { getCatalog } from '../data.js';
import { getMeta, setMeta } from '../db.js';
import { EMPTY_PANTRY, onHand } from '../pantry.js';
import { html, view, toast } from '../ui.js';

/** Pantry plus what the matching code needs: the on-hand set and the staple ids. */
export async function loadPantry() {
  const [stored, catalog] = await Promise.all([getMeta('pantry'), getCatalog()]);
  const pantry = { ...EMPTY_PANTRY, ...stored };
  return { pantry, catalog, have: onHand(pantry, catalog), staples: new Set(catalog.filter(c => c.staple).map(c => c.id)) };
}
export const savePantry = pantry => setMeta('pantry', pantry);

let query = '';
let onlyHave = false;

export async function render() {
  const { pantry, catalog } = await loadPantry();
  const have = new Set(pantry.have);
  const aisles = new Map();
  for (const c of catalog) {
    if (pantry.assumeStaples && c.staple) continue;
    if (!aisles.has(c.aisle)) aisles.set(c.aisle, []);
    aisles.get(c.aisle).push(c);
  }
  const groups = [...aisles].sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
  const stapleCount = catalog.filter(c => c.staple).length;

  const el = view(html`
    <div class="row between wrap">
      <h1>Pantry</h1>
      <div class="row wrap gap">
        <button class="btn" data-action="clear" ${pantry.have.length ? '' : 'disabled'}>Clear pantry</button>
        <a class="btn primary" href="#/can-make">What can I make?</a>
      </div>
    </div>
    <p class="lead">Tick what you have on hand. The planner leans toward recipes that use it, and the shopping list
      sets those items aside.</p>
    <div class="card stack">
      <label class="toggle"><input type="checkbox" name="assumeStaples" ${pantry.assumeStaples ? 'checked' : ''}>
        Count staples as on hand (${stapleCount}: salt, oil, flour, spices…)</label>
      <span class="have-count muted"></span>
    </div>
    <div class="search stack">
      <input type="search" name="q" value="${query}" placeholder="Find an ingredient" aria-label="Find an ingredient" autocomplete="off">
      <label class="toggle"><input type="checkbox" name="onlyHave" ${onlyHave ? 'checked' : ''}> Show only what I have</label>
    </div>
    ${groups.map(([aisle, items]) => html`<section class="aisle pantry-aisle"><h2>${aisle}</h2><ul class="shop">${items.map(c => html`
      <li data-name="${c.name}" class="${have.has(c.id) ? 'have' : ''}"><label>
        <input type="checkbox" data-id="${c.id}" ${have.has(c.id) ? 'checked' : ''}>
        <span class="item-name">${c.name}</span>${c.staple ? html`<span class="tag">staple</span>` : ''}
      </label></li>`)}</ul></section>`)}
    <p class="muted empty-note" hidden>No ingredients match.</p>`);

  const update = () => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of el.querySelectorAll('li[data-name]')) {
      const ok = words.every(w => li.dataset.name.includes(w)) && (!onlyHave || li.classList.contains('have'));
      li.hidden = !ok;
      shown += ok;
    }
    for (const s of el.querySelectorAll('.pantry-aisle')) s.hidden = !s.querySelector('li:not([hidden])');
    el.querySelector('.empty-note').hidden = shown > 0;
    const n = pantry.have.length;
    el.querySelector('.have-count').textContent = `${n} item${n === 1 ? '' : 's'} ticked`;
    el.querySelector('[data-action=clear]').disabled = n === 0;
  };

  el.addEventListener('input', e => {
    if (e.target.name === 'q') { query = e.target.value; update(); }
  });
  el.addEventListener('change', async e => {
    const t = e.target;
    if (t.name === 'onlyHave') { onlyHave = t.checked; return update(); }
    if (t.name === 'assumeStaples') {
      pantry.assumeStaples = t.checked;
      await savePantry(pantry);
      return rerender();
    }
    const id = t.dataset.id;
    if (!id) return;
    pantry.have = t.checked ? [...new Set([...pantry.have, id])] : pantry.have.filter(x => x !== id);
    t.closest('li').classList.toggle('have', t.checked);
    await savePantry(pantry);
    update();
  });
  // a weekly chore: one tap, with Undo instead of a confirmation
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-action]')?.dataset.action !== 'clear' || !pantry.have.length) return;
    const previous = pantry.have;
    await savePantry({ ...pantry, have: [] });
    rerender();
    toast(`Pantry cleared (${previous.length} item${previous.length === 1 ? '' : 's'})`, {
      label: 'Undo',
      run: async () => { await savePantry({ ...(await loadPantry()).pantry, have: previous }); rerender(); },
    });
  });
  update();
  return el;
}

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
