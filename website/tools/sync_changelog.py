"""Builds website/content/changelog.md from the release notes in docs/release-notes-*.md.

    website/.venv/Scripts/python website/tools/sync_changelog.py

Newest version first. Run it after adding a release-notes file, then commit the result.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
NOTES = ROOT / "docs"
OUTPUT = ROOT / "website" / "content" / "changelog.md"
DATES = {"1.0.0": "2026-11-08"}
RELEASES = "https://github.com/chaker88/ChakyBricks/releases"


def version_key(path: Path) -> tuple[int, ...]:
    match = re.search(r"release-notes-([\d.]+)\.md$", path.name)
    assert match is not None
    return tuple(int(part) for part in match.group(1).split("."))


def main() -> None:
    files = sorted(NOTES.glob("release-notes-*.md"), key=version_key, reverse=True)
    parts = [
        "# Changelog\n",
        f"All releases are on [GitHub]({RELEASES}); the installer for each version is attached there.\n",
    ]
    for path in files:
        version = ".".join(str(n) for n in version_key(path))
        body = path.read_text(encoding="utf-8").split("\n", 1)[1].strip()
        body = re.sub(r"^(#{2,})", r"#\1", body, flags=re.MULTILINE)
        body = body.replace("Details: [load-test.md]", "Details: [load-test report]")
        date = f" — {DATES[version]}" if version in DATES else ""
        parts.append(f"## {version}{date}\n\n[Download {version}]({RELEASES}/tag/v{version}){{ .md-button }}\n\n{body}\n")
    OUTPUT.write_text("\n".join(parts), encoding="utf-8")


if __name__ == "__main__":
    main()
