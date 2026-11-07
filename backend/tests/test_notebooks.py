from pathlib import Path

import nbformat
import pytest
from fastapi.testclient import TestClient

from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError
from chakybricks.notebooks import NotebookStore, clean_name


@pytest.fixture
def store(tmp_path: Path) -> NotebookStore:
    return NotebookStore(tmp_path / "notebooks")


def test_names() -> None:
    assert clean_name("  Sales   analysis ") == "Sales analysis"
    assert clean_name("تحليل المبيعات.ipynb") == "تحليل المبيعات"
    for bad in ["", "   ", "a/b", "a\\b", "x:y", ".hidden", "end.", "q?", "x" * 101]:
        with pytest.raises(InvalidInputError):
            clean_name(bad)


def test_create_read_save_rename_delete(store: NotebookStore) -> None:
    name = store.create(
        "Revenue",
        [
            {"cell_type": "markdown", "source": "# Title"},
            {"cell_type": "code", "source": "SELECT 1", "language": "sql"},
            {"cell_type": "code", "source": "x = 1"},
        ],
    )
    assert name == "Revenue"
    with pytest.raises(ConflictError):
        store.create("Revenue")
    notebook = store.read("Revenue")
    assert notebook["metadata"]["kernelspec"]["name"] == "chakybricks"
    assert [c["cell_type"] for c in notebook["cells"]] == ["markdown", "code", "code"]
    assert notebook["cells"][1]["metadata"] == {"chakybricks": {"language": "sql"}}
    assert all(c.get("id") for c in notebook["cells"])

    notebook["cells"][2]["source"] = "x = 2"
    notebook["cells"][2]["outputs"] = [{"output_type": "stream", "name": "stdout", "text": "hi\n"}]
    notebook["cells"][2]["execution_count"] = 1
    saved = store.save("Revenue", notebook)
    assert saved["size_bytes"] > 0
    assert store.read("Revenue")["cells"][2]["outputs"][0]["text"] == "hi\n"
    nbformat.validate(nbformat.read(store.path("Revenue"), as_version=4))

    with pytest.raises(InvalidInputError):
        store.save("Revenue", {"cells": "nope"})
    assert store.rename("Revenue", "Revenue 2024") == "Revenue 2024"
    assert [e["name"] for e in store.entries()] == ["Revenue 2024"]
    store.create("Other")
    with pytest.raises(ConflictError):
        store.rename("Other", "Revenue 2024")
    store.delete("Revenue 2024")
    with pytest.raises(NotFoundError):
        store.read("Revenue 2024")


def test_unique_names(store: NotebookStore) -> None:
    assert store.create(None) == "Untitled"
    assert store.create(None) == "Untitled 2"
    assert store.unique_name("Analysis") == "Analysis"


def test_notebook_api(client: TestClient) -> None:
    created = client.post("/api/notebooks", json={"name": "Explore"})
    assert created.status_code == 201
    assert client.post("/api/notebooks", json={"name": "Explore"}).status_code == 409
    notebook = client.get("/api/notebooks/Explore").json()
    notebook["cells"][0]["source"] = "print('hi')"
    assert client.put("/api/notebooks/Explore", json=notebook).status_code == 200
    assert client.get("/api/notebooks/Explore").json()["cells"][0]["source"] == "print('hi')"
    assert [n["name"] for n in client.get("/api/notebooks").json()] == ["Explore"]
    assert client.post("/api/notebooks/Explore/rename", json={"name": "Explore 2"}).json() == {
        "name": "Explore 2"
    }
    assert client.get("/api/notebooks/Explore").status_code == 404
    assert client.put("/api/notebooks/Explore 2", json={"cells": 1}).status_code == 422
    assert client.delete("/api/notebooks/Explore 2").status_code == 204
    assert client.post("/api/kernels", json={"notebook": "missing"}).status_code == 404
