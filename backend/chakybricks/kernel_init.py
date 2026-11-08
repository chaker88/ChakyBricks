"""Runs inside each notebook kernel: preloads `cb`, the %%sql magic and DataFrame rendering."""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
from typing import Any

import duckdb
import pandas as pd
import polars as pl
import pyarrow as pa

from chakybricks import cb
from chakybricks.engine import friendly_error
from chakybricks.errors import ChakyError
from chakybricks.kernel_env import explain_conflict
from chakybricks.serialization import relation_to_json

TABLE_MIME = "application/vnd.chakybricks.table+json"
DISPLAY_ROWS = 1000


class SqlCellError(Exception):
    """Shown as a short message instead of a Python traceback."""

    def _render_traceback_(self) -> list[str]:
        return [f"\x1b[31m{self}\x1b[0m"]


def table_payload(obj: Any, limit: int = DISPLAY_ROWS) -> dict[str, Any]:
    if isinstance(obj, pl.Series | pd.Series):
        obj = obj.to_frame()
    if isinstance(obj, pd.DataFrame):
        total = len(obj)
        head = obj.head(limit)
        if not isinstance(head.index, pd.RangeIndex):
            head = head.reset_index()
        data = pa.Table.from_pandas(head, preserve_index=False)
    elif isinstance(obj, pl.DataFrame):
        total = obj.height
        data = obj.head(limit).to_arrow()
    elif isinstance(obj, pa.Table):
        total = obj.num_rows
        data = obj.slice(0, limit)
    else:
        raise TypeError(f"Cannot display {type(obj).__name__} as a table")
    with duckdb.connect() as con:
        payload = relation_to_json(con.from_arrow(data))
    return {**payload, "row_count": total, "truncated": total > data.num_rows}


def _bundle(obj: Any, include: Any = None, exclude: Any = None) -> dict[str, Any]:
    return {TABLE_MIME: table_payload(obj)}


def sql_magic(line: str, cell: str) -> pl.DataFrame | None:
    name = line.strip()
    if name and not name.isidentifier():
        raise SqlCellError(f"%%sql {name}: the variable name must be a Python identifier")
    try:
        result = cb.sql(cell)
    except (duckdb.Error, ChakyError) as exc:
        raise SqlCellError(friendly_error(exc)) from None
    if name:
        from IPython import get_ipython

        shell = get_ipython()
        if shell is not None:
            shell.user_ns[name] = result
    return result


def pip_magic(line: str) -> None:
    """%pip that streams pip's output and explains refusals caused by the protected versions."""
    args = shlex.split(line, posix=os.name != "nt")
    process = subprocess.Popen(
        [sys.executable, "-m", "pip", *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert process.stdout is not None
    output: list[str] = []
    for chunk in process.stdout:
        output.append(chunk)
        print(chunk, end="", flush=True)
    if process.wait() != 0:
        explanation = explain_conflict("".join(output))
        if explanation:
            print(f"\n\x1b[31m{explanation}\x1b[0m", file=sys.stderr)
    elif args and args[0] in ("install", "uninstall"):
        print("Note: restart the kernel if you changed a package that was already imported.")


def setup() -> None:
    from IPython import get_ipython

    shell = get_ipython()
    if shell is None:
        return
    shell.user_ns["cb"] = cb
    formatter = shell.display_formatter.mimebundle_formatter
    for kind in (pl.DataFrame, pl.Series, pd.DataFrame, pd.Series, pa.Table):
        formatter.for_type(kind, _bundle)
    shell.register_magic_function(sql_magic, magic_kind="cell", magic_name="sql")
    shell.register_magic_function(pip_magic, magic_kind="line", magic_name="pip")
