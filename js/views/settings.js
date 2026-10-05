import { exportAll, importAll, getMeta } from '../db.js';
import { checkForUpdate } from '../data.js';
import { isoDate } from '../planner.js';
import { html, view, toast, rerender } from '../ui.js';
import { settings, saveSettings } from '../store.js';

export async function render() {
  const [cfg, apiVersion, persisted, estimate] = await Promise.all([
    settings(), getMeta('apiVersion'),
    navigator.storage?.persisted?.() ?? false,
    navigator.storage?.estimate?.() ?? null,
  ]);
  const weeks = Math.round(cfg.noRepeatDays / 7);
  const el = view(html`
    <h1>Settings</h1>

    <section class="card stack">
      <h2>Backup</h2>
      <p>Ratings, notes and plans live only on this device. Export a backup now and then, and import it to
        restore or to move to another device. Importing replaces what is here.</p>
      <div class="row wrap gap">
        <button class="btn primary" data-action="export">Export backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" name="import" hidden></label>
      </div>
      <p class="muted small">Storage: ${persisted ? 'protected from automatic clearing' : 'may be cleared by the browser if space runs low; adding the app to the Home Screen helps'}${
        estimate ? `, ${(estimate.usage / 1048576).toFixed(1)} MB used` : ''}.</p>
    </section>

    <section class="card stack">
      <h2>Planner</h2>
      <label class="field">Don't repeat a dinner for
        <select name="noRepeat">${[0, 1, 2, 3, 4, 6, 8].map(w =>
          html`<option value="${w}" ${w === weeks ? 'selected' : ''}>${w === 0 ? 'no limit' : `${w} week${w > 1 ? 's' : ''}`}</option>`)}</select>
      </label>
    </section>

    <section class="card stack">
      <h2>Recipe data</h2>
      <p class="muted">Version ${apiVersion ?? 'unknown'}. Updates download automatically when you are online.</p>
      <div><button class="btn" data-action="update">Check for updates</button></div>
    </section>`);

  el.addEventListener('click', async e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'export') {
      const file = new File([JSON.stringify(await exportAll(), null, 1)], `recipe-book-backup-${isoDate(new Date())}.json`, { type: 'application/json' });
      // Home Screen apps on iPad can't download to Files directly; the share sheet can ("Save to Files")
      if (navigator.standalone && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
      } else {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    }
    if (action === 'update') {
      const changed = await checkForUpdate();
      toast(changed ? 'Recipes updated' : navigator.onLine ? 'Recipes are up to date' : 'You are offline');
      if (changed) rerender();
    }
  });
  el.addEventListener('change', async e => {
    if (e.target.name === 'noRepeat') {
      await saveSettings({ noRepeatDays: +e.target.value * 7 });
      toast('Saved');
    }
    if (e.target.name === 'import') {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !confirm('Replace all ratings, notes and plans on this device with this backup?')) return;
      try {
        await importAll(JSON.parse(await file.text()));
        toast('Backup restored');
      } catch (err) {
        alert(`Could not import: ${err.message}`);
      }
    }
  });
  return el;
}
