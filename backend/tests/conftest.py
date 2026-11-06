from collections.abc import Iterator
from pathlib import Path

import duckdb
import openpyxl
import pytest
from fastapi.testclient import TestClient

from chakybricks.app import create_app
from chakybricks.services import Services

TOKEN = "test-token"
SALES_CSV = """order_id,Customer Name,order date,amount,region
1,Alice,2024-01-05,10.50,north
2,Bob,2024-01-06,20.00,south
3,Carol,2024-02-01,7.25,north
4,Dan,2024-02-03,13.00,east
"""


@pytest.fixture
def home(tmp_path: Path) -> Path:
    return tmp_path / "home"


@pytest.fixture
def services(home: Path) -> Iterator[Services]:
    svc = Services(home)
    yield svc
    svc.close()


@pytest.fixture
def client(home: Path) -> Iterator[TestClient]:
    with TestClient(create_app(TOKEN, home), headers={"X-ChakyBricks-Token": TOKEN}) as c:
        yield c


@pytest.fixture
def files(tmp_path: Path) -> dict[str, Path]:
    src = tmp_path / "src"
    src.mkdir()
    csv = src / "sales.csv"
    csv.write_text(SALES_CSV)
    tsv = src / "sales.tsv"
    tsv.write_text(SALES_CSV.replace(",", "\t"))
    ndjson = src / "events.ndjson"
    ndjson.write_text('{"id": 1, "kind": "click"}\n{"id": 2, "kind": "view"}\n')
    json_array = src / "events.json"
    json_array.write_text('[{"id": 1, "kind": "click"}, {"id": 2, "kind": "view"}]')
    parquet = src / "numbers.parquet"
    with duckdb.connect() as con:
        con.execute(
            f"COPY (SELECT i::UBIGINT AS big, i::INTEGER AS n FROM range(5) t(i)) "
            f"TO '{parquet.as_posix()}' (FORMAT parquet)"
        )
    xlsx = src / "budget.xlsx"
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["Item", "Cost", "Note"])
    sheet.append(["Laptop", 1200.5, "new"])
    sheet.append(["Desk", 300, 42])
    workbook.save(xlsx)
    return {
        "csv": csv,
        "tsv": tsv,
        "ndjson": ndjson,
        "json": json_array,
        "parquet": parquet,
        "xlsx": xlsx,
    }


def make_big_csv(path: Path, rows: int) -> Path:
    with duckdb.connect() as con:
        con.execute(
            f"COPY (SELECT i AS id, i % 97 AS bucket, 'row-' || i AS label "
            f"FROM range({rows}) t(i)) TO '{path.as_posix()}' (HEADER)"
        )
    return path
