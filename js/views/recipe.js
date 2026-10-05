import { getRecipe, getIndex } from '../data.js';
import { getStat, updateStat, getNote, setNote, putPlan } from '../db.js';
import { isMain, isoDate } from '../planner.js';
import { formatQuantity } from '../units.js';
import { html, view, stars, formatDay, toast } from '../ui.js';
import { currentPlan } from './plan.js';

const SCALES = [0.5, 1, 2];

export async function render({ slug }) {
  let recipe;
  try {
    recipe = await getRecipe(slug);
  } catch {
    return view(html`<h1>Recipe not found</h1><p class="lead">It may have been renamed.</p><a class="btn" href="#/recipes">All recipes</a>`);
  }
  const [stat, note, index, plan] = await Promise.all([getStat(recipe.id), getNote(recipe.id), getIndex(), currentPlan()]);
  const entry = index.find(e => e.id === recipe.id);
  let scale = 1;

  const el = view(html`
    <article class="recipe">
      <header>
        <p class="muted">${recipe.category}${recipe.subcategory ? ` · ${recipe.subcategory}` : ''}</p>
        <h1>${recipe.title}</h1>
        ${recipe.description ? html`<p class="lead">${recipe.description}</p>` : ''}
        <p class="meta muted">
          ${recipe.servings ? html`<span>${recipe.servings.text}</span>` : ''}
          ${recipe.times.map(t => html`<span>${t.label}: ${t.text}</span>`)}
          ${recipe.source?.attribution ? html`<span>${/^(from|recipe|magazine)\b/i.test(recipe.source.attribution) ? '' : 'From '}${recipe.source.attribution}</span>` : ''}
        </p>
        <div class="row wrap gap">
          <span class="rating-slot">${stars(stat.rating, { interactive: true, size: 'big' })}</span>
          <button class="btn ${stat.favorite ? 'on' : ''}" data-action="favorite" aria-pressed="${!!stat.favorite}">${stat.favorite ? '♥ Favorite' : '♡ Favorite'}</button>
          <button class="btn primary" data-action="cook">Start cooking</button>
          <button class="btn primary exit-cook" data-action="cook">Done cooking</button>
        </div>
      </header>

      <section class="ingredients">
        <div class="row between wrap"><h2>Ingredients</h2>
          <div class="chips" role="group" aria-label="Scale">${SCALES.map(m =>
            html`<button class="chip" data-scale="${m}" aria-pressed="${m === 1}">${m === 0.5 ? '½' : m}×</button>`)}</div>
        </div>
        <div class="ingredient-list"></div>
      </section>

      <section class="steps">
        <h2>Directions</h2>
        ${recipe.steps.length ? groupBy(recipe.steps).map(([group, steps]) => html`
          ${group ? html`<h3>${group}</h3>` : ''}
          <ol>${steps.map(s => html`<li tabindex="0">${s.text}</li>`)}</ol>`)
          : html`<p class="muted">The original recipe has no directions.</p>`}
      </section>

      ${recipe.footnotes?.length ? html`<section><h2>Tips</h2>${recipe.footnotes.map(f => html`<p>${f}</p>`)}</section>` : ''}
      ${recipe.importedNotes?.length ? html`<section><h2>Notes from the original</h2>${recipe.importedNotes.map(n => html`<p>${n.text}</p>`)}</section>` : ''}
      ${recipe.seeAlso?.length ? html`<section><h2>See also</h2><ul>${recipe.seeAlso.map(s =>
        html`<li><a href="#/recipe/${s}">${index.find(e => e.slug === s)?.title ?? s}</a></li>`)}</ul></section>` : ''}
      ${recipe.nutrition ? html`<details><summary>Nutrition</summary><p class="small">${recipe.nutrition.text}</p></details>` : ''}

      <section class="card stack">
        <h2>My notes</h2>
        <textarea name="note" rows="4" placeholder="Changes, timings, what everyone thought…">${note}</textarea>
        <span class="muted small save-state" aria-live="polite"></span>
      </section>

      <section class="card stack planner-box">
        <h2>Meal planning</h2>
        <p class="muted stat-line"></p>
        <label class="toggle"><input type="checkbox" name="main" ${isMain(entry, stat) ? 'checked' : ''}> Can be a dinner main</label>
        <label class="toggle"><input type="checkbox" name="excluded" ${stat.excluded ? 'checked' : ''}> Never suggest this</label>
        <div class="row wrap gap">
          <button class="btn" data-action="cooked">Cooked it today</button>
          ${plan ? html`<label class="small-select">Put in plan
            <select name="plan-day"><option value="">Choose a day…</option>${plan.days.map((d, i) =>
              html`<option value="${i}">${formatDay(d.date)}${d.recipeId === recipe.id ? ' (already)' : ''}</option>`)}</select></label>` : ''}
        </div>
      </section>
    </article>`);

  const list = el.querySelector('.ingredient-list');
  const drawIngredients = () => {
    list.innerHTML = groupBy(recipe.ingredients).map(([group, lines]) => html`
      ${group ? html`<h3>${group}</h3>` : ''}
      <ul>${lines.map(l => html`<li tabindex="0" class="${l.optional ? 'optional' : ''}">${ingredientText(l, scale)}</li>`)}</ul>`.__html).join('');
  };
  let current = stat;
  const drawStats = () => {
    const s = current;
    const parts = [`Suggested ${s.timesRecommended ?? 0} time${s.timesRecommended === 1 ? '' : 's'}`,
      `cooked ${s.timesCooked ?? 0} time${s.timesCooked === 1 ? '' : 's'}`];
    if (s.lastCooked) parts.push(`last cooked ${formatDay(s.lastCooked, { month: 'short', day: 'numeric', year: 'numeric' })}`);
    el.querySelector('.stat-line').textContent = `${parts.join(', ')}.`;
  };
  drawIngredients();
  drawStats();

  let wakeLock = null;
  const lockScreen = async () => {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed right now */ }
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && document.body.classList.contains('cooking')) lockScreen(); };
  document.addEventListener('visibilitychange', onVisible);
  el.cleanup = () => {
    document.body.classList.remove('cooking');
    wakeLock?.release();
    document.removeEventListener('visibilitychange', onVisible);
  };

  el.addEventListener('click', async e => {
    const scaleBtn = e.target.closest('[data-scale]');
    if (scaleBtn) {
      scale = +scaleBtn.dataset.scale;
      el.querySelectorAll('[data-scale]').forEach(b => b.setAttribute('aria-pressed', b === scaleBtn));
      return drawIngredients();
    }
    // in cooking mode, tap a line to mark it done / the current step
    const line = e.target.closest('.ingredient-list li, .steps li');
    if (line && document.body.classList.contains('cooking')) {
      if (line.closest('.steps')) {
        el.querySelectorAll('.steps li.current').forEach(li => li !== line && li.classList.remove('current'));
        line.classList.toggle('current');
      } else line.classList.toggle('done');
      return;
    }
    const btn = e.target.closest('[data-action]');
    switch (btn?.dataset.action) {
      case 'rate': {
        const n = +btn.dataset.value;
        current = await updateStat(recipe.id, { rating: current.rating === n ? null : n });
        el.querySelector('.rating-slot').innerHTML = stars(current.rating, { interactive: true, size: 'big' }).__html;
        return;
      }
      case 'favorite':
        current = await updateStat(recipe.id, { favorite: !current.favorite });
        btn.classList.toggle('on', current.favorite);
        btn.setAttribute('aria-pressed', current.favorite);
        btn.textContent = current.favorite ? '♥ Favorite' : '♡ Favorite';
        return;
      case 'cook': {
        const on = document.body.classList.toggle('cooking');
        if (on) { await lockScreen(); window.scrollTo(0, 0); } else { wakeLock?.release(); wakeLock = null; }
        return;
      }
      case 'cooked': {
        const today = isoDate(new Date());
        current = await updateStat(recipe.id, s => ({ timesCooked: (s.timesCooked ?? 0) + 1, lastCooked: today, prevCooked: s.lastCooked ?? null }));
        drawStats();
        toast('Marked as cooked today');
      }
    }
  });

  let noteTimer;
  el.addEventListener('input', e => {
    if (e.target.name !== 'note') return;
    const state = el.querySelector('.save-state');
    state.textContent = '';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => { await setNote(recipe.id, e.target.value); state.textContent = 'Saved'; }, 500);
  });
  el.addEventListener('change', async e => {
    const t = e.target;
    if (t.name === 'main') current = await updateStat(recipe.id, { main: t.checked === entry.tags.includes('main') ? undefined : t.checked });
    if (t.name === 'excluded') current = await updateStat(recipe.id, { excluded: t.checked });
    if (t.name === 'plan-day' && t.value !== '') {
      const day = plan.days[+t.value];
      Object.assign(day, { recipeId: recipe.id, locked: true, skip: false, cooked: false });
      await putPlan(plan);
      toast(`Planned for ${formatDay(day.date, { weekday: 'long' })}`);
      t.value = '';
    }
  });
  return el;
}

function groupBy(lines) {
  const groups = [];
  for (const l of lines) {
    const g = l.group ?? null;
    if (!groups.length || groups.at(-1)[0] !== g) groups.push([g, []]);
    groups.at(-1)[1].push(l);
  }
  return groups;
}

// Original wording unless scaling a line that parsed cleanly.
function ingredientText(l, scale) {
  if (scale === 1 || l.confidence === 'low' || l.quantity == null || l.shop === false) {
    return scale !== 1 && l.quantity != null ? html`${l.raw} <span class="tag">×${scale === 0.5 ? '½' : scale}</span>` : l.raw;
  }
  const qty = formatQuantity(l.quantity * scale, l.quantityMax != null ? l.quantityMax * scale : null);
  return [qty, l.unit, l.item].filter(Boolean).join(' ') + (l.prep ? `, ${l.prep}` : '') + (l.note ? ` (${l.note})` : '');
}
