# Recipe site

Hobby project ("Adele's Recipe Book") to give Dennis's wife a searchable recipe collection with weekly dinner plans, shopping lists and cook notes.
Small scale, one household, no deadlines. Prefer simple over clever; avoid adding infrastructure.

## Shape of the system

- **PWA** (installable, works offline, added to an iPad Home Screen) with a service worker. Static hosting on GitHub Pages
  as a project site: https://dennisdunn.github.io/recipe-book/ (repo `dennisdunn/recipe-book`, site and API in one repo).
- **Plain static, no framework, no build step, no Jekyll** (`.nojekyll` at the root). ES modules in `js/`, one stylesheet
  in `css/`, hash routes because Pages has no SPA fallback: simple view `#/`, `#/choose`, `#/choose/tonight`,
  `#/tonight`, `#/dish/<slug>`; helper view
  `#/plan`, `#/menu`, `#/plans`, `#/shop`, `#/pantry`, `#/can-make`, `#/recipes`, `#/recipe/<slug>`, `#/settings`.
  The only dependency is `idb`, vendored in `js/vendor/idb.js`.
- **Recipes are read-only static JSON** in `api/` (see `api/README.md` and `api/recipe.schema.json`). No server, no database.
  The import was one-time; recipes are edited by hand-editing files, then `node tools/build-index.mjs`.
- **User data lives in the browser** (IndexedDB): ratings, notes, plans, pantry, planner counts. Never write it to the API files.
  Full CRUD / server storage is a possible future project, not part of this one.

## The data contract

- `api/version.json` (changes with any recipe edit) -> `api/index.json` (one entry per recipe: list, search, planner and
  pantry matching, `time`) -> `api/recipes/<slug>.json` (full recipe). The service worker stores all of them up front.
  `api/catalog.json` supplies ingredient names, aisles and staple flags; `api/categories/` and `api/tags/` for browsing.
- Recipe `id` is an immutable UUID: key all user data on it. `slug` is only the URL/file name and may change.
- Do not change the recipe JSON shape without updating `api/recipe.schema.json`, `tools/build-index.mjs` and `api/README.md`.
- `REVIEW.md` lists recipes with uncertain data (blurry image transcriptions, missing directions); `TIMES-REVIEW.md`
  records where each dinner's `time` came from. The app uses neither (Pages publishes them, with `tools/` and `README.md`).
- The `main` tag marks dinner entrées the planner may pick (110 recipes, hand-curated). Users can override it per recipe in the app.
- Ingredient lines with `confidence: "low"`: display `raw`, not the parsed fields.

## Simple view (the default; `js/views/simple.js`, with Home's logic in `js/simple-state.js`)

The main user is in the early stage of dementia and uses the app alone, mostly to decide the week's dinners.
The app opens in the simple view; everything else is the **helper view**, reached by **pressing and holding the logo
for 2 seconds** (a ring fills while holding; `js/app.js`). Nothing on screen points to it. The helper view's topbar has
"Simple view", and the app always opens on Home. Rules for the simple view — keep them when changing it:

- One task per screen and few choices, always in the same place (the choose bar is pinned to the bottom).
- Plain words: weekday names, no dates, no jargon (no lock/swap/scale/staples). No tab bar.
- No `confirm()` dialogs, no timed messages or Undo toasts. "Remove" only empties a day (choose again to refill it).
- Home has two sections, so an unfinished menu can still be cooked from (which buttons show is `homeState()`,
  pure and tested in `tests/simple-state.test.mjs`; change the rules there, not in the markup):
  - **Tonight**: tonight's dinner with "Show me how to make it", or "Choose tonight's dinner" (`#/choose/tonight`,
    which returns to Home after "Yes").
  - **This week**: the days with their dinners and "Choose the next dinner" (or "Change dinners" once all are chosen).
- Choose: the dinner's title, time (only once all are reviewed) and main ingredient **names** (no amounts, staples or
  optional lines); "Yes, add it" / "Show me another". The offer comes from `offerForMenu()` in `js/store.js`, shared
  with the helper's menu builder. Days fill in order from the first open one (a day whose recipe left the book is open
  again); the chosen dinners
  above have Remove buttons. Each "Yes" counts that dinner as suggested right away (`savePlanCounts`).
  Tonight's pick never takes more than 2 hours (`TONIGHT_MAX_MINUTES` in `js/store.js`).
- Dinner titles link to their recipe (`#/dish/<slug>`: the full recipe, large, with one Back button), except
  tonight's: its only way in is "Show me how to make it" (one path to tonight's recipe).
- Tonight: the full recipe, large, with the screen kept awake; nothing else to press.
- "Print the shopping list" (Home, once a dinner is chosen): one tap prints the week's list with the helper's rules
  (`shoppingFor` in `js/store.js`: no staples, pantry items set aside, ticked items left out) and two-column layout
  (`balanceColumns` in `js/widgets.js`). It fills a screen-hidden `.simple-print` section and prints only that.
- The week is `menuDates()` (helper Settings: how many dinners, from which weekday; default 5 from Monday): the rest of
  the current window, or the next one once it is over. The stored plan covering those dates is the simple week.
- `time` (in each main's recipe file): all 110 were reviewed by Dennis on 2026-10-26 (`TIMES-REVIEW.md`). Times show only
  while every main has `reviewed: true`, so a new main needs a reviewed `time` or all times disappear.

## Meal planner (`js/planner.js`, pure)

- Two ways to plan a week, both offered on the plan screen:
  - **Plan my week** (`fillPlan`): all 7 days at once, at random.
  - **Build a menu** (`#/menu`, `pickOne`): one dinner at a time, shown as the full recipe (`js/recipe-view.js`).
    "Add to menu" fills the next open day (locked), "Show another" passes it over, "No dinner <day>" skips the day.
    Progress lives in `plan.menu` ({ offer, passed }), so a menu can be left and resumed. When every day is filled or
    skipped, the done screen offers Save (counts the dinners, like "Save plan"). Open days in any plan show
    "Not chosen yet" with Pick at random / Skip, and the plan screen offers to continue in the menu builder.
- Both pick by weighted random over mains that are not excluded and not rated 1 star.
- Recipes cooked or recommended within the no-repeat window (default 3 weeks, set in Settings) are left out while enough remain.
- Ratings and favorites raise the odds; long-unseen recipes get a mild boost; the same category on adjacent days is discouraged.
- Days can be locked, swapped, skipped (eating out), scaled (½× to 3×) and marked cooked.
- Every plan is kept (store `plans`, keyed by start date, so a new plan with the same start replaces the old one).
  Past plans (`#/plans`): Open makes one current; Repeat copies its dinners into a new week (locked; days whose recipe
  left the book get a fresh pick), defaulting to the day after the latest plan; Delete has an Undo toast.
- `timesRecommended` / `lastRecommended` change when a dinner is counted as suggested (`savePlanCounts`): on "Save plan"
  / "Save menu" in the helper view, and on each "Yes, add it" in the simple view; never on a swap or "Show another".
  `timesCooked` / `lastCooked` change on "Cooked it".

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
- The app shell is one cached set per `SHELL_VERSION`, served cache-first: a new version installs a complete fresh set
  before taking over, so an installed app never runs a mix of old and new files (that broke the app once: a new module
  importing from an old cached one). **Bump `SHELL_VERSION` whenever any shell file changes** and list new files in
  `SHELL_FILES`; `tools/check.mjs` enforces both. Changes reach installed apps on the next launch.
- API files are stale-while-revalidate (background refresh uses `cache: 'no-cache'`).
- `version.json` is always fetched from the network (`cache: 'no-store'`). When it differs from `meta.apiVersion`, the page
  asks the worker (`refresh-api` message) to re-download the API.
- GitHub Pages serves project sites from `/<repo>/`: use relative URLs or a configured base path, never root-absolute ones.

## Working conventions

- Mobile-first and readable at arm's length in a kitchen: large type, high contrast, keep the screen awake in cooking view
  (Screen Wake Lock API where available).
- Printing (helper recipe page and shopping list have a Print button; the simple view has "Print the shopping list"):
  `@media print` in `css/app.css` prints black on white and hides controls, anything marked `.no-print` (rating, meal
  planning box) and ticked-off shopping items. Notes print via a `.print-only` copy of the textarea; collapsed
  `<details>` open for printing (`beforeprint` in `js/app.js`). Safari ignores CSS `columns` on paper, so shopping lists
  render two explicit `.col` containers, balanced by unticked items (`balanceColumns()` in `js/widgets.js`); check
  print changes in WebKit, not just Chromium.
- Run `node tools/check.mjs` before every commit (offline file list, `SHELL_VERSION` bump, imports, URLs, syntax,
  `tests/`). Put logic in the pure modules (`planner.js`, `shopping.js`, `pantry.js`, `units.js`, `simple-state.js`)
  and cover it in `tests/`; state shared by screens goes
  in `js/store.js` and UI pieces used by several screens in `js/widgets.js` and `js/recipe-view.js` (the full
  recipe page) — screens never import each other.
  `js/store.js` handles data only (no dialogs or markup); a screen asks `confirm()` itself before calling it.
  From `js/ui.js`: build markup with `html` (escapes values), insert it with `setHTML()` / `appendHTML()`, redraw with
  `rerender()` (`{ top: true }` to start at the top), and use `plural()` for counts and `weekday()` for day names.
- `css/app.css` is in numbered sections (tokens, base, layout, controls, helper screens, simple view, printing); add rules
  to the matching section. Rule order can decide which style wins, so prefer adding over moving rules.
- Errors: the router shows the simple view a plain "Something went wrong" with one "Start again" button; only the
  helper view shows the technical message.
- Keep dependencies few. Any build tooling must produce plain static files that work on GitHub Pages.
- Test with the real data (254 recipes), including edge cases: recipes with no directions, no quantities, ranges (`quantityMax`),
  groups (`ingredients[].group`, `steps[].group`), and `seeAlso` links.

## Local preview

Serve the repo's parent so the site is at `/recipe-book/`, as on Pages (catches root-absolute URLs):
`python3 -m http.server 8411 --directory ..` then open http://localhost:8411/recipe-book/.
The service worker serves the app from its cached set, so edits only show after bumping `SHELL_VERSION`
in `sw.js` (then reload twice) or with the service worker bypassed in the browser's developer tools.

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
