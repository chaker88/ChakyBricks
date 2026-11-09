# ChakyBricks website

The project site at <https://chaker88.github.io/ChakyBricks/>, built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/). Everything for the site lives in this folder (the repository's `docs/` folder is separate).

```
website/
  mkdocs.yml            site configuration (navigation, theme, extensions)
  requirements.txt      pinned Python dependency
  content/              the pages (Markdown), stylesheets and images
  assets/logo.png       master logo; the variants in content/assets are generated from it
  tools/                make_logos.py (logo variants and favicon), sync_changelog.py
```

## Build and preview locally

Requires Python 3.12 (`py -3.12` on Windows). From the repository root:

```powershell
py -3.12 -m venv website\.venv
website\.venv\Scripts\python -m pip install -r website\requirements.txt
cd website
.venv\Scripts\python -m mkdocs serve     # live preview at http://127.0.0.1:8000, reloads on save
.venv\Scripts\python -m mkdocs build --strict   # writes website\site\; fails on broken links
```

Set `NO_MKDOCS_2_WARNING=1` to hide the "Material for MkDocs end of life" banner. `website\.venv` and `website\site` are git-ignored.

## Deployment

`.github/workflows/website.yml` builds the site and deploys it to GitHub Pages on every push to `main` that touches `website/`, and can be run by hand (Actions → Website → Run workflow). If Actions is unavailable, build locally as above; the generated `website\site` folder is a plain static site.

## Updating for a release

1. Add `docs/release-notes-<version>.md`, then run `website\.venv\Scripts\python website\tools\sync_changelog.py` (add the release date to `DATES` in that script) to regenerate `content/changelog.md`.
2. Update the version and installer size on the home page (`content/index.md`) and in `content/docs/getting-started.md`.
3. If features changed, update the matching page under `content/docs/`.
4. Run `mkdocs build --strict` and commit.

To regenerate the logo variants after changing `assets/logo.png`: `website\.venv\Scripts\python website\tools\make_logos.py` (needs `pillow` and `numpy`).
