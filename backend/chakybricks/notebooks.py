from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import nbformat

from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError

SUFFIX = ".ipynb"
MAX_NAME_LENGTH = 100
_INVALID_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
KERNELSPEC = {
    "name": "chakybricks",
    "display_name": "ChakyBricks (Python 3.12)",
    "language": "python",
}
LANGUAGE_INFO = {"name": "python", "version": "3.12", "file_extension": ".py"}


def clean_name(name: str) -> str:
    name = " ".join(name.split())
    if name.lower().endswith(SUFFIX):
        name = name[: -len(SUFFIX)].rstrip()
    if not name:
        raise InvalidInputError("Enter a notebook name")
    if len(name) > MAX_NAME_LENGTH:
        raise InvalidInputError(f"Notebook names are limited to {MAX_NAME_LENGTH} characters")
    if _INVALID_NAME.search(name) or name.startswith(".") or name.endswith("."):
        raise InvalidInputError(
            'Notebook names cannot contain \\ / : * ? " < > | or start/end with "."'
        )
    return name


def new_notebook(cells: list[dict[str, Any]] | None = None) -> nbformat.NotebookNode:
    notebook = nbformat.v4.new_notebook()
    notebook.metadata["kernelspec"] = KERNELSPEC
    notebook.metadata["language_info"] = LANGUAGE_INFO
    for cell in cells or [{"cell_type": "code", "source": ""}]:
        kind = cell.get("cell_type", "code")
        source = cell.get("source", "")
        made = (
            nbformat.v4.new_markdown_cell(source)
            if kind == "markdown"
            else nbformat.v4.new_code_cell(source)
        )
        if cell.get("language") == "sql":
            made.metadata["chakybricks"] = {"language": "sql"}
        notebook.cells.append(made)
    return notebook


class NotebookStore:
    def __init__(self, folder: Path) -> None:
        self.folder = folder

    def path(self, name: str) -> Path:
        return self.folder / f"{clean_name(name)}{SUFFIX}"

    def entries(self) -> list[dict[str, Any]]:
        entries = []
        for path in self.folder.glob(f"*{SUFFIX}"):
            stat = path.stat()
            entries.append(
                {
                    "name": path.stem,
                    "updated_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                    "size_bytes": stat.st_size,
                }
            )
        return sorted(entries, key=lambda e: e["updated_at"], reverse=True)

    def unique_name(self, base: str = "Untitled") -> str:
        base = clean_name(base)
        name, n = base, 2
        while self.path(name).exists():
            name, n = f"{base} {n}", n + 1
        return name

    def create(self, name: str | None, cells: list[dict[str, Any]] | None = None) -> str:
        name = clean_name(name) if name else self.unique_name()
        path = self.path(name)
        if path.exists():
            raise ConflictError(f"A notebook named '{name}' already exists")
        self._write(path, new_notebook(cells))
        return name

    def read(self, name: str) -> dict[str, Any]:
        path = self._existing(name)
        notebook = nbformat.read(path, as_version=4)
        return json.loads(json.dumps(notebook))

    def save(self, name: str, content: dict[str, Any]) -> dict[str, Any]:
        path = self._existing(name)
        try:
            notebook = nbformat.from_dict(content)
            nbformat.validate(notebook)
        except Exception as exc:
            raise InvalidInputError(f"Invalid notebook: {exc}") from exc
        self._write(path, notebook)
        stat = path.stat()
        return {
            "name": name,
            "updated_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
            "size_bytes": stat.st_size,
        }

    def rename(self, name: str, new_name: str) -> str:
        source = self._existing(name)
        new_name = clean_name(new_name)
        target = self.path(new_name)
        if target.exists() and target.resolve() != source.resolve():
            raise ConflictError(f"A notebook named '{new_name}' already exists")
        source.rename(target)
        return new_name

    def delete(self, name: str) -> None:
        self._existing(name).unlink()

    def _existing(self, name: str) -> Path:
        path = self.path(name)
        if not path.is_file():
            raise NotFoundError(f"Notebook '{name}' does not exist")
        return path

    def _write(self, path: Path, notebook: nbformat.NotebookNode) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".ipynb.tmp")
        tmp.write_text(nbformat.writes(notebook), encoding="utf-8")
        tmp.replace(path)
