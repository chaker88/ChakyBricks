# ChakyBricks website

The project site at <https://chaker88.github.io/ChakyBricks/>, built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/). Everything for the site lives in this folder (the repository's `docs/` folder is separate).

```
website/
  mkdocs.yml            site configuration (navigation, theme, extensions)
  requirements.txt      pinned build dependencies (used by Cloudflare / CI)
  requirements-tools.txt  extra packages for tools/make_logos.py only
  content/              the pages (Markdown), stylesheets and images
  assets/logo.png       master logo; the variants in content/assets are generated from it
  tools/                make_logos.py (logo variants and favicon), sync_changelog.py
```

## Build and preview locally

Requires Python 3.12 (`py -3.12` on Windows). From the repository root:

```powershell
py -3.12 -m venv website\.venv
website\.venv\Scripts\python -m pip install -r website
equirements.txt
cd website
.venv\Scripts\python -m mkdocs serve    # live preview at http://127.0.0.1:8000, reloads on save
.venv\Scripts\python -m mkdocs build --strict    # writes website\site\; fails on broken links
```

On Linux or macOS (and on Cloudflare) the whole build is one command, run from `website/`:

```sh
pip install -r requirements.txt && mkdocs build --strict
```

`requirements.txt` pins everything the build needs (MkDocs, Material and their dependencies). Set `NO_MKDOCS_2_WARNING=1` to hide the "Material for MkDocs end of life" banner. `website\.venv` and `website\site` are git-ignored. The helper scripts in `tools/` are **not** part of the build: they are run by hand, and their results (`content/assets/*`, `content/changelog.md`) are committed. `sync_changelog.py` needs only Python; `make_logos.py` needs `pip install -r requirements-tools.txt` (Pillow, NumPy).

## Deployment: Cloudflare Pages

The site is a static folder, so any static host works. With Cloudflare Pages, connect the GitHub repository (Workers & Pages → Create → Pages → Connect to Git → `chaker88/ChakyBricks`, production branch `main`) and use these settings:

| Setting                | Value                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Framework preset       | **None**                                                                                                                     |
| Root directory         | `website`                                                                                                                    |
| Build command          | `pip install -r requirements.txt && mkdocs build --strict`                                                                   |
| Build output directory | `site`                                                                                                                       |
| Environment variable   | `PYTHON_VERSION` = `3.12`                                                                                                    |
| Environment variable   | `NO_MKDOCS_2_WARNING` = `1` (optional, hides a banner)                                                                       |
| Environment variable   | `SITE_URL` = your site address, e.g. `https://chakybricks.pages.dev/` (optional; adds canonical links and a correct sitemap) |

Notes:

- The output directory is relative to the root directory, so it is `site`, not `website/site`.
- `website/.python-version` also pins Python 3.12 for the build.
- Cloudflare rebuilds on every push to `main`; use **Settings → Builds → Build watch paths** (include `website/*`) if you only want rebuilds when the site changes. Pushes to other branches get preview deployments.
- A custom domain can be added under the project's **Custom domains** tab.

`.github/workflows/website.yml` is an optional GitHub Pages alternative (manual run only); it is not needed when using Cloudflare.

## Updating for a release

1. Add `docs/release-notes-<version>.md`, then run `website\.venv\Scripts\python website\tools\sync_changelog.py` (add the release date to `DATES` in that script) to regenerate `content/changelog.md`.
2. Update the version and installer size on the home page (`content/index.md`) and in `content/docs/getting-started.md`.
3. If features changed, update the matching page under `content/docs/`.
4. Run `mkdocs build --strict` and commit.

To regenerate the logo variants after changing `assets/logo.png`: `website\.venv\Scripts\python website\tools\make_logos.py` (needs `pillow` and `numpy`).
