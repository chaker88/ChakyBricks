import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient


def wait_for_import(client: TestClient, job_id: str) -> dict[str, Any]:
    deadline = time.time() + 30
    while time.time() < deadline:
        job: dict[str, Any] = client.get(f"/api/imports/{job_id}").json()
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("import did not finish")


def import_csv(client: TestClient, path: Path, schema: str, table: str, **extra: Any) -> None:
    preview = client.post("/api/imports/preview", json={"path": str(path)}).json()
    response = client.post(
        "/api/imports",
        json={
            "path": str(path),
            "format": preview["format"],
            "columns": preview["source_columns"],
            "schema_name": schema,
            "table": table,
            **extra,
        },
    )
    assert response.status_code == 202, response.text
    assert wait_for_import(client, response.json()["id"])["state"] == "succeeded"


def test_preview_endpoint(client: TestClient, files: dict[str, Path]) -> None:
    response = client.post("/api/imports/preview", json={"path": str(files["csv"])})
    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "csv"
    assert body["suggested_table"] == "sales"
    assert "VARCHAR" in body["editable_types"]

    columns = body["source_columns"]
    columns[0]["type"] = "VARCHAR"
    typed = client.post(
        "/api/imports/preview", json={"path": str(files["csv"]), "columns": columns[:2]}
    ).json()
    assert [c["type"] for c in typed["sample"]["columns"]] == ["VARCHAR", "VARCHAR"]
    assert typed["sample"]["rows"][0][0] == "1"


def test_preview_errors(client: TestClient, files: dict[str, Path], tmp_path: Path) -> None:
    missing = client.post("/api/imports/preview", json={"path": str(tmp_path / "x.csv")})
    assert missing.status_code == 422
    assert "not found" in missing.json()["detail"]
    columns = client.post("/api/imports/preview", json={"path": str(files["csv"])}).json()[
        "source_columns"
    ]
    columns[1]["type"] = "INTEGER"
    bad_cast = client.post(
        "/api/imports/preview", json={"path": str(files["csv"]), "columns": columns}
    )
    assert bad_cast.status_code == 422
    assert "Preview failed" in bad_cast.json()["detail"]


def test_catalog_table_lifecycle(client: TestClient, files: dict[str, Path]) -> None:
    assert client.post("/api/schemas", json={"name": "sales"}).status_code == 201
    import_csv(client, files["csv"], "sales", "orders")

    catalog = client.get("/api/catalog").json()["schemas"]
    sales = next(s for s in catalog if s["name"] == "sales")
    assert sales["tables"][0]["name"] == "orders"
    assert sales["tables"][0]["row_count"] == 4
    assert {"name": "region", "type": "VARCHAR"} in sales["tables"][0]["columns"]

    detail = client.get("/api/tables/sales/orders").json()
    assert detail["source"] == str(files["csv"].resolve())
    assert detail["size_bytes"] > 0
    assert detail["partition_columns"] == []

    sample = client.get("/api/tables/sales/orders/sample?limit=2").json()
    assert len(sample["rows"]) == 2

    import_csv(client, files["csv"], "sales", "orders", mode="append")
    history = client.get("/api/tables/sales/orders/history").json()
    assert [h["version"] for h in history] == [1, 0]
    assert len(client.get("/api/tables/sales/orders/sample?version=0").json()["rows"]) == 4
    assert len(client.get("/api/tables/sales/orders/sample?version=1").json()["rows"]) == 8
    assert client.get("/api/tables/sales/orders/sample?version=7").status_code == 422

    renamed = client.post(
        "/api/tables/sales/orders/rename", json={"schema_name": "archive", "name": "old_orders"}
    )
    assert renamed.status_code == 200, renamed.text
    assert client.get("/api/tables/sales/orders").status_code == 404
    assert client.get("/api/tables/archive/old_orders/sample").json()["rows"]

    assert client.delete("/api/tables/archive/old_orders").status_code == 204
    assert client.get("/api/tables/archive/old_orders").status_code == 404
    assert client.delete("/api/schemas/archive").status_code == 204


def test_arabic_table_through_api(client: TestClient, files: dict[str, Path]) -> None:
    import_csv(client, files["arabic"], "main", "employees", partition_by="المدينة")

    catalog = client.get("/api/catalog").json()["schemas"]
    columns = catalog[0]["tables"][0]["columns"]
    assert {"name": "الاسم", "type": "VARCHAR"} in columns
    assert {"name": "prénom", "type": "VARCHAR"} in columns

    detail = client.get("/api/tables/main/employees").json()
    assert detail["partition_columns"] == ["المدينة"]
    assert detail["row_count"] == 3

    sample = client.get("/api/tables/main/employees/sample").json()
    names = [c["name"] for c in sample["columns"]]
    assert "الاسم_الكامل" in names
    row = dict(zip(names, sample["rows"][0], strict=True))
    assert row["المدينة"] in ("تونس", "صفاقس")
    assert client.get("/api/tables/main/employees/sample?version=0").status_code == 200
    assert client.get("/api/tables/main/employees/history").json()[0]["version"] == 0


def test_import_conflict_returns_409(client: TestClient, files: dict[str, Path]) -> None:
    import_csv(client, files["csv"], "main", "sales")
    preview = client.post("/api/imports/preview", json={"path": str(files["csv"])}).json()
    response = client.post(
        "/api/imports",
        json={
            "path": str(files["csv"]),
            "format": "csv",
            "columns": preview["source_columns"],
            "schema_name": "main",
            "table": "sales",
        },
    )
    assert response.status_code == 409


def test_settings_roundtrip(client: TestClient, tmp_path: Path, files: dict[str, Path]) -> None:
    settings = client.get("/api/settings").json()
    assert settings["memory_limit_mb"] is None
    assert settings["effective_memory_limit_mb"] == settings["default_memory_limit_mb"]

    updated = client.put("/api/settings", json={"memory_limit_mb": 1024}).json()
    assert updated["effective_memory_limit_mb"] == 1024
    assert client.put("/api/settings", json={"memory_limit_mb": 1}).status_code == 422

    new_workspace = tmp_path / "elsewhere"
    moved = client.put("/api/settings", json={"workspace": str(new_workspace)}).json()
    assert Path(moved["workspace"]) == new_workspace.resolve()
    assert (new_workspace / "warehouse").is_dir()
    assert (new_workspace / "meta.db").is_file()
    import_csv(client, files["csv"], "main", "sales")
    assert (new_workspace / "warehouse" / "main" / "sales").is_dir()

    reset = client.put("/api/settings", json={"memory_limit_mb": None}).json()
    assert reset["memory_limit_mb"] is None
    assert Path(reset["workspace"]) == new_workspace.resolve()


def test_background_settings_roundtrip(client: TestClient) -> None:
    settings = client.get("/api/settings").json()
    assert settings["keep_running_in_background"] is False
    assert settings["start_with_system"] is False
    updated = client.put("/api/settings", json={"keep_running_in_background": True}).json()
    assert updated["keep_running_in_background"] is True
    assert updated["start_with_system"] is False
    assert client.get("/api/settings").json()["keep_running_in_background"] is True
