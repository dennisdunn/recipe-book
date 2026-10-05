# Adele's Recipe Book

A family recipe collection as an offline web app: search 254 recipes, plan a week of dinners, get a shopping list,
and keep ratings and cooking notes. It runs from plain static files on GitHub Pages and installs on an iPad like an app.

**Live site:** https://dennisdunn.github.io/recipe-book/

## What it does

- **Plan:** picks seven dinners at random from the recipes tagged as mains. Favorites and high ratings come up more
  often, and anything cooked or suggested in the last few weeks rests. Days can be locked, swapped, skipped, scaled
  (½× to 3×) and marked cooked. Every week is kept under **Past plans**, where it can be reopened, repeated or deleted.
- **Shop:** a shopping list for the week, merged by ingredient and grouped by aisle, in US kitchen units. Staples
  (salt, oil, flour…) are hidden unless you want them, and items already in the pantry are set aside. Prints in two
  columns without the ticked-off items.
- **Pantry:** tick what you have on hand. **What can I make?** lists recipes you can cook now or are one or two items
  short of, and **Use what I have** makes the planner favor them. Clearing it is one tap, with Undo.
- **Recipes:** search by title or ingredient, filter by mains, favorites, ratings or keto. Each recipe has a star
  rating, favorite, notes, scaling, printing, and a cooking mode with large type that keeps the screen awake.
- **Works offline:** after the first visit, every recipe is stored on the device.

## On the iPad

1. Open the live site in **Safari** while online, and wait a moment so it can store the recipes.
2. Tap **Share → Add to Home Screen**. It appears as "Adele's Recipes".
3. App updates arrive by themselves: they show up the second time it is opened while online.

Ratings, notes, plans and the pantry live **only on that device**. Use **Settings → Export backup** now and then
(choose "Save to Files"); **Import backup** restores it or moves it to another device. Importing replaces what is there.

## Editing recipes

Recipes are JSON files in `api/recipes/`, one per recipe; the format is described in [`api/README.md`](api/README.md)
and [`api/recipe.schema.json`](api/recipe.schema.json).

1. Edit or add a file in `api/recipes/`. A new recipe needs a new UUID `id` and ingredient `catalogId`s that exist in
   `api/catalog.json`. Add the tag `main` to make it a dinner candidate for the planner.
2. Run `node tools/build-index.mjs` (Node 18 or newer). It checks the recipes and rebuilds the index, categories,
   tags and version file.
3. Commit and push. Devices download the changed recipes the next time the app is opened online.

[`REVIEW.md`](REVIEW.md) lists recipes from the original import that need checking against the source files.

## Development

No framework and no build step: ES modules in `js/`, one stylesheet in `css/app.css`, a service worker in `sw.js`.
The only dependency is [idb](https://github.com/jakearchibald/idb), saved in `js/vendor/`.

Preview locally with the site under `/recipe-book/`, as on GitHub Pages, so path mistakes show up:

```bash
python3 -m http.server 8411 --directory ..
```

Then open http://localhost:8411/recipe-book/. The service worker caches aggressively: reload twice to see changes,
or bypass it in the browser's developer tools.

| Path | What it is |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js` | page shell, install manifest, offline cache |
| `js/app.js` | start-up and the hash router (`#/`, `#/shop`, `#/pantry`, `#/recipes`, …) |
| `js/planner.js`, `js/shopping.js`, `js/pantry.js`, `js/units.js` | the logic, with no DOM or storage (runs in Node too) |
| `js/data.js`, `js/db.js`, `js/store.js` | recipe data from `api/`; user data in IndexedDB; state shared by screens |
| `js/views/` | one module per screen |
| `tests/` | tests for the logic modules and the recipe data (`node --test tests/`) |
| `api/` | the recipe data (see [`api/README.md`](api/README.md)) |
| `tools/build-index.mjs` | validates recipes and regenerates the index files |
| `tools/check.mjs` | pre-push check: offline file list, imports, URLs, syntax and tests |
| `brand.html`, `icons/` | brand sheet, icon sources and sizes |
| `CLAUDE.md` | design notes and conventions |

Before committing, run the check (Node 18 or newer):

```bash
node tools/check.mjs
```

It runs the tests and catches the mistakes that are easy to miss: a file the app loads but the service worker does
not cache (the app would fail to start offline; add it to `SHELL_FILES` in `sw.js` and bump `SHELL_VERSION`), a
broken import, or a root-absolute URL that would break under `/recipe-book/`.

## Deployment

GitHub Pages serves the `main` branch from the repository root. `.nojekyll` makes Pages publish the files as they are.

## License

The code is under the [MIT License](LICENSE). The recipes in `api/` are a private family collection, and some come
from published sources that keep their rights; they are not covered by the MIT License. The bundled idb library is
under its own ISC license.
