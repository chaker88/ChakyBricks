"""Fail if a bundled runtime contains packages outside the default list.

The default list is the dependency closure of the `chakybricks` package (plus pip), so a stray
`pip install` into the runtime — a test, a smoke run, a developer — can never ship.

    <runtime>/python.exe scripts/check_runtime.py
"""

from __future__ import annotations

import sys
import sysconfig
from importlib import metadata
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ALWAYS_ALLOWED = {"pip"}


def closure(root: str = "chakybricks") -> set[str]:
    """Every distribution `root` needs, following extras and environment markers."""
    needed: set[str] = set()
    stack: list[tuple[str, frozenset[str]]] = [(root, frozenset())]
    seen: set[tuple[str, frozenset[str]]] = set()
    while stack:
        name, extras = stack.pop()
        if (name, extras) in seen:
            continue
        seen.add((name, extras))
        needed.add(canonicalize_name(name))
        try:
            requirements = metadata.distribution(name).requires or []
        except metadata.PackageNotFoundError:
            continue
        for text in requirements:
            requirement = Requirement(text)
            if requirement.marker is not None:
                contexts = [{"extra": extra} for extra in extras] or [{"extra": ""}]
                if not any(requirement.marker.evaluate(context) for context in contexts):
                    continue
            stack.append((requirement.name, frozenset(requirement.extras)))
    return needed


def installed(site_packages: Path) -> set[str]:
    return {
        canonicalize_name(dist.metadata["Name"])
        for dist in metadata.distributions(path=[str(site_packages)])
        if dist.metadata["Name"]
    }


def problems(site_packages: Path) -> tuple[set[str], set[str]]:
    expected = closure() | ALWAYS_ALLOWED
    present = installed(site_packages)
    return present - expected, closure() - present


def main() -> int:
    site_packages = Path(sysconfig.get_paths()["purelib"])
    unexpected, missing = problems(site_packages)
    if unexpected or missing:
        if unexpected:
            print(f"Runtime has packages outside the default list: {', '.join(sorted(unexpected))}")
        if missing:
            print(f"Runtime is missing required packages: {', '.join(sorted(missing))}")
        print(f"({site_packages}) Rebuild it with: npm run build:runtime -- -Clean")
        return 1
    print(f"Runtime OK: {len(installed(site_packages))} packages, all from the default list")
    return 0


if __name__ == "__main__":
    sys.exit(main())
