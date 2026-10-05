# Recipe site

Hobby project ("Adele's Recipe Book") to give Dennis's wife a searchable recipe collection with weekly dinner plans, shopping lists and cook notes.
Small scale, one household, no deadlines. Prefer simple over clever; avoid adding infrastructure.

## Shape of the system

- **PWA** (installable, works offline, added to an iPad Home Screen) with a service worker. Static hosting on GitHub Pages
  as a project site: https://dennisdunn.github.io/recipe-book/ (repo `dennisdunn/recipe-book`, site and API in one repo).
- **Plain static, no framework, no build step, no Jekyll** (`.nojekyll` at the root). ES modules in `js/`, one stylesheet
  in `css/`, hash routes (`#/`, `#/shop`, `#/recipes`, `#/recipe/<slug>`, `#/settings`) because Pages has no SPA fallback.
  The only dependency is `idb`, vendored in `js/vendor/idb.js`.
- **Recipes are read-only static JSON** in `api/` (see `README.md` and `api/recipe.schema.json`). No server, no database.
  The import was one-time; recipes are edited by hand-editing files, then `node tools/build-index.mjs`.
- **User data lives in the browser** (IndexedDB): ratings, notes, plans, planner counts. Never write it to the API files.
  Full CRUD / server storage is a possible future project, not part of this one.

## The data contract

- Fetch order for the UI: `api/version.json` -> `api/index.json` (list + search) -> `api/recipes/<slug>.json` on demand.
  `api/catalog.json` supplies ingredient names, aisles and staple flags; `api/categories/` and `api/tags/` for browsing.
- Recipe `id` is an immutable UUID: key all user data on it. `slug` is only the URL/file name and may change.
- Do not change the recipe JSON shape without updating `api/recipe.schema.json`, `tools/build-index.mjs` and `README.md`.
- `REVIEW.md` lists recipes with uncertain data (blurry image transcriptions, missing directions). The app does not use it
  (Pages does publish it, along with `tools/` and `README.md`).
- The `main` tag marks dinner entrées the planner may pick (110 recipes, hand-curated). Users can override it per recipe in the app.
- Ingredient lines with `confidence: "low"`: display `raw`, not the parsed fields.

## Meal planner (`js/planner.js`, pure)

- Plans 7 days from a chosen start date: weighted random over mains that are not excluded and not rated 1 star.
- Recipes cooked or recommended within the no-repeat window (default 3 weeks, set in Settings) are left out while enough remain.
- Ratings and favorites raise the odds; long-unseen recipes get a mild boost; the same category on adjacent days is discouraged.
- Days can be locked, swapped, skipped (eating out), scaled (½× to 3×) and marked cooked.
- Every plan is kept (store `plans`, keyed by start date, so a new plan with the same start replaces the old one).
  Past plans (`#/plans`): Open makes one current; Repeat copies its dinners into a new week (locked; days whose recipe
  left the book get a fresh pick), defaulting to the day after the latest plan; Delete has an Undo toast.
- `timesRecommended` / `lastRecommended` only change when a plan is **saved**, never on a swap; `timesCooked` / `lastCooked`
  on "Cooked it".

## Pantry (`js/pantry.js`, pure; screens `#/pantry` and `#/can-make`)

- A persistent have/don't-have list of catalog ids (no quantities), stored in `meta.pantry` as `{ have, assumeStaples }`.
  With `assumeStaples` (default) catalog staples count as on hand and are left out of the counts.
- Matching uses `index.json` `need`: the recipe's required catalog ids (not optional, `shop !== false`).
- "What can I make?" lists recipes using at least one ticked item, grouped by missing 0, 1 or 2.
- "Use what I have" (`settings.usePantry`) multiplies planner weights by `20 ** coverage` for recipes using ticked items.
- The shopping list moves ticked pantry items to a collapsed "Already have" section (not printed); "I'm out" unticks one.
- Clearing is a weekly chore: one tap with an Undo toast, no confirmation dialog.

## Shopping list rules (`js/shopping.js`, pure; runs in Node for testing)

- Skip lines with `shop: false`; hide `catalog.staple` items by default (with a toggle to show them).
- Merge by `catalogId`, summing `amount.value` per `amount.unit` (g, ml, each, pkg). Group by `catalog.aisle`.
- Amounts converted between units (density, each-weight) are approximate and should be labeled as such.
  The catalog does not yet carry density data; see Pending below.
- Ingredients with `amount: null` ("to taste") get one line with no quantity.
- Low-confidence lines are not summed; their `raw` text is shown under the matching item.
- Scale by a per-recipe multiplier before merging. Format display amounts at the UI layer (e.g. 236.6 ml -> 1 cup).

## Browser storage

- IndexedDB database `recipe-book` (see `js/db.js`): `stats` (rating, favorite, main override, excluded, recommended/cooked
  counts and dates) and `notes`, both keyed by recipe `id`; `plans` keyed by start date (days, shopping checkmarks, extra items);
  `meta` (currentPlan, settings, pantry, apiVersion). Change the schema only with a version bump and an upgrade step.
- Request persistent storage (`navigator.storage.persist()`) so notes are not evicted.
- Export/import of user data as a JSON file (Settings) is the only backup. On an iPad Home Screen app, export uses the share sheet.

## Service worker

- Precache the app shell **and the whole API, every recipe included** (~2 MB): the planner needs all ingredient lists offline.
- Everything is stale-while-revalidate (background refresh uses `cache: 'no-cache'`), so app changes show on the next launch.
  Bump `SHELL_VERSION` in `sw.js` and update `SHELL_FILES` when adding, renaming or removing shell files.
- `version.json` is always fetched from the network (`cache: 'no-store'`). When it differs from `meta.apiVersion`, the page
  asks the worker (`refresh-api` message) to re-download the API.
- GitHub Pages serves project sites from `/<repo>/`: use relative URLs or a configured base path, never root-absolute ones.

## Working conventions

- Mobile-first and readable at arm's length in a kitchen: large type, high contrast, keep the screen awake in cooking view
  (Screen Wake Lock API where available).
- Printing (recipe page and shopping list have a Print button): `@media print` in `css/app.css` prints black on white and
  hides controls, anything marked `.no-print` (rating, meal planning box) and ticked-off shopping items. Notes print via a
  `.print-only` copy of the textarea; collapsed `<details>` open for printing (`beforeprint` in `js/app.js`).
  Safari ignores CSS `columns` on paper, so the shopping list renders two explicit `.col` containers, balanced by unticked
  items (`balance()` in `js/views/shop.js`); check print changes in WebKit, not just Chromium.
- Keep dependencies few. Any build tooling must produce plain static files that work on GitHub Pages.
- Test with the real data (254 recipes), including edge cases: recipes with no directions, no quantities, ranges (`quantityMax`),
  groups (`ingredients[].group`, `steps[].group`), and `seeAlso` links.

## Local preview

Serve the repo's parent so the site is at `/recipe-book/`, as on Pages (catches root-absolute URLs):
`python3 -m http.server 8411 --directory ..` then open http://localhost:8411/recipe-book/.
The service worker caches aggressively; use DevTools > Application to bypass or unregister it while developing.

## Branding

- Name: "Adele's Recipe Book"; Home Screen label "Adele's Recipes". Direction "Herb garden": rosemary green, warm white, mustard.
- `brand.html` is the reference sheet (palette, tokens with contrast ratios, icons, how to regenerate PNGs).
- Colors only through the `:root` tokens in `css/app.css` (light and dark). Mustard is decorative, never text.
- Icon sources are `icons/icon.svg` and `icons/favicon.svg`; PNGs are rendered from them with `rsvg-convert`. Keep the file names.

## Pending data work

- Add `measure`, `densityGPerMl` and `eachWeightG` to `api/catalog.json` (source: `normalize.py` or `recipes.sqlite3` from the import chat),
  then use them in `js/shopping.js` to merge g with ml/each lines (labeled approximate).
- Reference articles (a separate collection from the import) are not yet in the API.
- No images yet; add an optional `image` field when there are any.
