"""Generate THIRD_PARTY_NOTICES.txt for everything ChakyBricks bundles.

Covers the Python packages in the dependency closure of the backend, the production npm packages
of the frontend and the Rust crates of the Tauri shell. Run it from the repo root with the project
venv (so the closure is resolved against the pinned versions that ship):

    backend\\.venv\\Scripts\\python.exe scripts\\generate_notices.py        (Windows)
    backend/.venv/bin/python scripts/generate_notices.py                   (Linux/macOS)

Pass --check to fail when the committed file is out of date.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import sysconfig
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path

from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "THIRD_PARTY_NOTICES.txt"
LICENSE_NAMES = ("licen", "copying", "notice", "copyright", "authors", "unlicense")
MAX_FILE_BYTES = 400_000

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_runtime import closure

BUNDLED_WITH_PYTHON = [
    ("CPython 3.12 (python-build-standalone)", "PSF-2.0", "https://www.python.org/"),
    ("OpenSSL", "Apache-2.0", "https://www.openssl.org/"),
    ("SQLite", "Public domain", "https://www.sqlite.org/copyright.html"),
    ("zlib", "Zlib", "https://zlib.net/"),
    ("bzip2", "bzip2-1.0.6", "https://sourceware.org/bzip2/"),
    ("XZ Utils / liblzma", "Public domain", "https://tukaani.org/xz/"),
    ("libffi", "MIT", "https://sourceware.org/libffi/"),
    ("Expat", "MIT", "https://libexpat.github.io/"),
    ("mpdecimal", "BSD-2-Clause", "https://www.bytereef.org/mpdecimal/"),
    ("Tcl/Tk", "TCL (BSD-style)", "https://www.tcl.tk/software/tcltk/license.html"),
]


@dataclass
class Component:
    ecosystem: str
    name: str
    version: str
    license: str
    url: str = ""
    texts: list[str] = field(default_factory=list)


def read_text(path: Path) -> str | None:
    try:
        if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
            return None
        return (
            path.read_bytes()
            .decode("utf-8", errors="replace")
            .replace("\r\n", "\n")
            .strip()
        )
    except OSError:
        return None


def license_files(folder: Path) -> list[str]:
    texts: list[str] = []
    if not folder.is_dir():
        return texts
    for path in sorted(folder.iterdir()):
        if path.is_file() and path.name.lower().startswith(LICENSE_NAMES):
            text = read_text(path)
            if text:
                texts.append(text)
    return texts


def python_components() -> list[Component]:
    components: list[Component] = []
    for name in sorted(closure()):
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        info = dist.metadata
        if canonicalize_name(info["Name"] or name) == "chakybricks":
            continue
        license_name = info.get("License-Expression") or ""
        if not license_name:
            raw = info.get("License") or ""
            license_name = raw if 0 < len(raw) < 120 and "\n" not in raw else ""
        if not license_name:
            license_name = ", ".join(
                c.split("::")[-1].strip()
                for c in info.get_all("Classifier") or []
                if c.startswith("License ::")
            )
        texts: list[str] = []
        for file in dist.files or []:
            parts = [p.lower() for p in file.parts]
            is_license = (
                file.name.lower().startswith(LICENSE_NAMES) or "licenses" in parts
            )
            if is_license and ".dist-info" in "/".join(file.parts) + "/":
                text = read_text(Path(str(dist.locate_file(file))))
                if text:
                    texts.append(text)
        raw = info.get("License") or ""
        if not texts and len(raw) >= 120:
            texts.append(raw.strip())
        url = info.get("Home-page") or ""
        if not url:
            for entry in info.get_all("Project-URL") or []:
                label, _, link = entry.partition(",")
                if label.strip().lower() in (
                    "homepage",
                    "home",
                    "source",
                    "repository",
                ):
                    url = link.strip()
                    break
        components.append(
            Component(
                "Python",
                info["Name"] or name,
                dist.version,
                license_name or "see text",
                url,
                texts,
            )
        )
    return components


def python_runtime_text() -> str | None:
    for base in (Path(sys.base_prefix), Path(sysconfig.get_paths()["stdlib"]).parent):
        for candidate in ("LICENSE.txt", "LICENSE"):
            text = read_text(base / candidate)
            if text:
                return text
    return None


def npm_components() -> list[Component]:
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    components: list[Component] = []
    for key, entry in sorted(lock.get("packages", {}).items()):
        if (
            not key
            or entry.get("dev")
            or entry.get("devOptional")
            and not entry.get("optional")
        ):
            continue
        folder = ROOT / key
        package = folder / "package.json"
        if not package.is_file():
            continue
        info = json.loads(package.read_text(encoding="utf-8"))
        license_value = info.get("license") or entry.get("license") or ""
        if isinstance(license_value, dict):
            license_value = license_value.get("type", "")
        repository = info.get("repository")
        url = info.get("homepage") or (
            repository.get("url", "")
            if isinstance(repository, dict)
            else repository or ""
        )
        components.append(
            Component(
                "npm",
                info.get("name") or key.split("node_modules/")[-1],
                info.get("version", ""),
                str(license_value) or "see text",
                str(url),
                license_files(folder),
            )
        )
    return components


def host_triple() -> str:
    output = subprocess.run(
        ["rustc", "-vV"],
        check=True,
        capture_output=True,
        encoding="utf-8",
        stdin=subprocess.DEVNULL,
    ).stdout
    return next(
        line.split(":", 1)[1].strip()
        for line in output.splitlines()
        if line.startswith("host:")
    )


def rust_components() -> list[Component]:
    result = subprocess.run(
        [
            "cargo",
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--filter-platform",
            host_triple(),
            "--manifest-path",
            str(ROOT / "src-tauri" / "Cargo.toml"),
        ],
        check=True,
        capture_output=True,
        encoding="utf-8",
        stdin=subprocess.DEVNULL,
    )
    data = json.loads(result.stdout)
    reachable = {n["id"] for n in data["resolve"]["nodes"]}
    components: list[Component] = []
    for package in sorted(data["packages"], key=lambda p: (p["name"], p["version"])):
        if package["id"] not in reachable or package.get("source") is None:
            continue
        folder = Path(package["manifest_path"]).parent
        texts = license_files(folder)
        license_file = package.get("license_file")
        if license_file and not texts:
            text = read_text(folder / license_file)
            if text:
                texts.append(text)
        components.append(
            Component(
                "Rust",
                package["name"],
                package["version"],
                package.get("license") or "see text",
                package.get("homepage") or package.get("repository") or "",
                texts,
            )
        )
    return components


def render(groups: list[tuple[str, list[Component]]]) -> str:
    lines = [
        "ChakyBricks — third-party notices",
        "=" * 34,
        "",
        "ChakyBricks is created by Chaker Saidi (https://github.com/chaker88) and licensed under",
        "the Apache License 2.0 (see LICENSE and NOTICE). It bundles the open-source software",
        "listed below, each under its own license. This file is generated by",
        "scripts/generate_notices.py — do not edit it by hand.",
        "",
    ]
    texts: dict[str, str] = {}
    users: dict[str, list[str]] = {}

    def text_id(text: str) -> str:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]
        texts.setdefault(digest, text)
        return digest

    for title, components in groups:
        lines += ["", title, "-" * len(title), ""]
        for c in components:
            ids = sorted({text_id(t) for t in c.texts})
            for digest in ids:
                users.setdefault(digest, []).append(f"{c.name} {c.version}")
            refs = (
                f"  [text: {', '.join(ids)}]"
                if ids
                else "  [no license file shipped; see URL]"
            )
            url = f"  {c.url}" if c.url else ""
            lines.append(f"{c.name} {c.version} — {c.license}{url}{refs}")
    lines += ["", "", "Python runtime components", "-------------------------", ""]
    lines.append("The bundled python-build-standalone distribution includes:")
    for name, license_name, url in BUNDLED_WITH_PYTHON:
        lines.append(f"  {name} — {license_name} — {url}")
    runtime = python_runtime_text()
    if runtime:
        digest = text_id(runtime)
        users.setdefault(digest, []).append(
            "CPython and the bundled runtime components"
        )
    lines += ["", "", "License texts", "=============", ""]
    for digest in sorted(texts, key=lambda d: users.get(d, [""])[0].lower()):
        names = users.get(digest, [])
        shown = ", ".join(names[:12]) + (
            f" and {len(names) - 12} more" if len(names) > 12 else ""
        )
        lines += [
            "-" * 78,
            f"[{digest}] used by: {shown}",
            "-" * 78,
            "",
            texts[digest],
            "",
        ]
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check", action="store_true", help="fail if the file is out of date"
    )
    args = parser.parse_args()
    groups = [
        ("Python packages", python_components()),
        ("npm packages (frontend)", npm_components()),
        ("Rust crates (desktop shell)", rust_components()),
    ]
    content = render(groups)
    total = sum(len(g) for _, g in groups)
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != content:
            print(
                "THIRD_PARTY_NOTICES.txt is out of date; run scripts/generate_notices.py"
            )
            return 1
        print(f"THIRD_PARTY_NOTICES.txt is up to date ({total} components)")
        return 0
    OUTPUT.write_text(content, encoding="utf-8", newline="\n")
    missing = [c for _, g in groups for c in g if not c.texts]
    print(f"Wrote {OUTPUT.name}: {total} components, {len(content) / 1024:.0f} KiB")
    if missing:
        print(
            f"{len(missing)} components without a license file: "
            + ", ".join(f"{c.name}" for c in missing[:40])
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
