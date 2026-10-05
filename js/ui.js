// Small rendering helpers: an auto-escaping html`` template and a few shared widgets.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

export const raw = s => ({ __html: s });
const str = v => (v == null || v === false ? '' : Array.isArray(v) ? v.map(str).join('')
  : v.__html !== undefined ? v.__html : esc(v));
export const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? str(vals[i]) : ''), ''));

/** Build a view root from a template; the caller attaches listeners to it before it is shown. */
export function view(tpl) {
  const el = document.createElement('div');
  el.className = 'view';
  el.innerHTML = tpl.__html;
  return el;
}

export function stars(rating, { size = '', interactive = false } = {}) {
  if (!interactive) {
    if (!rating) return '';
    return html`<span class="stars ${size}" aria-label="${rating} stars">${'★'.repeat(rating)}<span class="dim">${'★'.repeat(5 - rating)}</span></span>`;
  }
  return html`<span class="stars rate ${size}" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n =>
    html`<button type="button" data-action="rate" data-value="${n}" role="radio" aria-checked="${rating === n}"
      aria-label="${n} star${n > 1 ? 's' : ''}" class="${n <= (rating ?? 0) ? 'on' : ''}">★</button>`)}</span>`;
}

export function formatDay(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);
}

/** Redraw the current screen (the router re-renders on hashchange and keeps the scroll position). */
export const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

let toastTimer;
/** Brief message; with `action` ({ label, run }) it shows a button (e.g. Undo) and stays up a little longer. */
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.textContent = message;
  if (action) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: action.label });
    btn.addEventListener('click', () => { el.hidden = true; action.run(); });
    el.append(' ', btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3000);
}
