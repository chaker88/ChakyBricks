import base64
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

from chakybricks.dashboard_models import Condition, DashboardSpec, OptionsQuery, TileQuery
from chakybricks.demo import CATEGORY, SAMPLE_NAME, SAMPLE_TABLE, create_sample_dashboard
from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError, QueryCancelledError
from chakybricks.services import Services
from tests.test_sql import add_table

START = date(2024, 1, 1)
TABLE = {"kind": "table", "table": "main.orders"}


@pytest.fixture
def orders(services: Services) -> Services:
    days = [START + timedelta(days=i) for i in range(120)]
    add_table(
        services,
        "main",
        "orders",
        pa.table(
            {
                "day": days,
                "region": ["north", "south", "east", "west"] * 30,
                "المنتج": ["قهوة", "شاي", "ماء"] * 40,
                "amount": [float(i % 10 + 1) for i in range(120)],
                "units": list(range(120)),
            }
        ),
    )
    return services


def tile(
    services: Services, kind: str, config: dict[str, Any], conditions: list[dict[str, Any]] | None
) -> dict[str, Any]:
    request = TileQuery.model_validate(
        {
            "type": kind,
            "source": TABLE,
            "config": config,
            "conditions": conditions or [],
        }
    )
    return services.dashboard_queries.run(request)


def rows(result: dict[str, Any]) -> list[list[Any]]:
    return result["rows"]


def test_bar_aggregates_sorts_and_limits(orders: Services) -> None:
    config = {
        "chart": "bar",
        "dimension": {"column": "region"},
        "metrics": [{"agg": "sum", "column": "amount"}],
        "limit": 3,
    }
    result = tile(orders, "chart", config, None)
    assert len(rows(result)) == 3
    assert result["truncated"] is True
    totals = [r[1] for r in rows(result)]
    assert totals == sorted(totals, reverse=True)


def test_date_grain_buckets_and_orders_by_time(orders: Services) -> None:
    config = {
        "chart": "line",
        "dimension": {"column": "day", "grain": "month"},
        "metrics": [{"agg": "count"}],
    }
    result = tile(orders, "chart", config, None)
    assert [r[0] for r in rows(result)][:2] == ["2024-01-01", "2024-02-01"]
    assert sum(r[1] for r in rows(result)) == 120
    quarters = tile(
        orders,
        "chart",
        {**config, "dimension": {"column": "day", "grain": "quarter"}},
        None,
    )
    assert [r[0] for r in rows(quarters)] == ["2024-01-01", "2024-04-01"]
    weeks = tile(orders, "chart", {**config, "dimension": {"column": "day", "grain": "week"}}, None)
    assert all(date.fromisoformat(r[0]).weekday() == 0 for r in rows(weeks))


def test_arabic_columns_and_values(orders: Services) -> None:
    config = {
        "chart": "bar",
        "dimension": {"column": "المنتج"},
        "metrics": [{"agg": "sum", "column": "units"}],
    }
    result = tile(orders, "chart", config, [{"column": "المنتج", "kind": "in", "values": ["شاي"]}])
    assert [r[0] for r in rows(result)] == ["شاي"]


def test_breakdown_pivots_and_caps_series(orders: Services) -> None:
    config = {
        "chart": "stacked_bar",
        "dimension": {"column": "المنتج"},
        "breakdown": {"column": "region"},
        "metrics": [{"agg": "sum", "column": "amount"}],
    }
    result = tile(orders, "chart", config, None)
    assert [c["name"] for c in result["columns"]] == ["_d", "_b", "_m0"]
    assert len(rows(result)) == 12
    assert result["series_truncated"] is False
    assert result["truncated"] is False


def test_breakdown_series_cap(services: Services) -> None:
    add_table(
        services,
        "main",
        "many",
        pa.table(
            {"k": [f"s{i % 12}" for i in range(120)], "d": ["a", "b", "c"] * 40, "v": [1] * 120}
        ),
    )
    request = TileQuery.model_validate(
        {
            "type": "chart",
            "source": {"kind": "table", "table": "main.many"},
            "config": {
                "chart": "bar",
                "dimension": {"column": "d"},
                "breakdown": {"column": "k"},
                "metrics": [{"agg": "sum", "column": "v"}],
            },
        }
    )
    result = services.dashboard_queries.run(request)
    assert result["series_truncated"] is True
    assert len({r[1] for r in rows(result)}) == 8


def test_scatter_pie_heatmap_combo_shapes(orders: Services) -> None:
    scatter = tile(
        orders,
        "chart",
        {
            "chart": "scatter",
            "dimension": {"column": "region"},
            "metrics": [{"agg": "avg", "column": "amount"}, {"agg": "sum", "column": "units"}],
        },
        None,
    )
    assert len(scatter["columns"]) == 3
    pie = tile(
        orders,
        "chart",
        {
            "chart": "donut",
            "dimension": {"column": "region"},
            "metrics": [{"agg": "sum", "column": "amount"}],
        },
        None,
    )
    assert len(rows(pie)) == 4
    heat = tile(
        orders,
        "chart",
        {
            "chart": "heatmap",
            "dimension": {"column": "region"},
            "breakdown": {"column": "المنتج"},
            "metrics": [{"agg": "count"}],
        },
        None,
    )
    assert len(rows(heat)) == 12
    combo = tile(
        orders,
        "chart",
        {
            "chart": "combo",
            "dimension": {"column": "day", "grain": "month"},
            "metrics": [
                {"agg": "sum", "column": "amount", "shape": "bar"},
                {"agg": "max", "column": "amount", "shape": "line"},
            ],
        },
        None,
    )
    assert len(combo["columns"]) == 3


def test_filters_are_parameters_not_sql(orders: Services) -> None:
    config = {
        "chart": "bar",
        "dimension": {"column": "region"},
        "metrics": [{"agg": "count"}],
    }
    hostile = "x'; DROP TABLE orders; --"
    result = tile(
        orders, "chart", config, [{"column": "region", "kind": "in", "values": [hostile]}]
    )
    assert rows(result) == []
    assert tile(orders, "chart", config, None)["rows"]
    date_filtered = tile(
        orders,
        "chart",
        config,
        [{"column": "day", "kind": "date_range", "start": "2024-01-01", "end": "2024-01-04"}],
    )
    assert sum(r[1] for r in rows(date_filtered)) == 4
    number = tile(
        orders,
        "chart",
        config,
        [{"column": "units", "kind": "number_range", "minimum": 10, "maximum": 19}],
    )
    assert sum(r[1] for r in rows(number)) == 10


def test_conditions_on_missing_columns_are_ignored(orders: Services) -> None:
    config = {"chart": "bar", "dimension": {"column": "region"}, "metrics": [{"agg": "count"}]}
    result = tile(orders, "chart", config, [{"column": "nope", "kind": "in", "values": ["a"]}])
    assert sum(r[1] for r in rows(result)) == 120


def test_cross_filter_on_date_bucket(orders: Services) -> None:
    config = {"chart": "bar", "dimension": {"column": "region"}, "metrics": [{"agg": "count"}]}
    result = tile(
        orders,
        "chart",
        config,
        [{"column": "day", "kind": "in", "grain": "month", "values": ["2024-02-01"]}],
    )
    assert sum(r[1] for r in rows(result)) == 29


def test_null_values_can_be_selected(services: Services) -> None:
    add_table(services, "main", "n", pa.table({"k": ["a", None, "b", None], "v": [1, 2, 3, 4]}))
    request = TileQuery.model_validate(
        {
            "type": "chart",
            "source": {"kind": "table", "table": "main.n"},
            "config": {
                "chart": "bar",
                "dimension": {"column": "k"},
                "metrics": [{"agg": "sum", "column": "v"}],
            },
            "conditions": [{"column": "k", "kind": "in", "values": [None, "a"]}],
        }
    )
    result = services.dashboard_queries.run(request)
    assert sorted((r[0] or "", r[1]) for r in rows(result)) == [("", 6.0), ("a", 1.0)]


def test_kpi_with_comparison_and_trend(orders: Services) -> None:
    config = {
        "metrics": [{"agg": "count"}],
        "compare": {"mode": "previous_period", "column": "day"},
        "trend": {"column": "day", "grain": "week"},
    }
    condition = {"column": "day", "kind": "date_range", "start": "2024-02-01", "end": "2024-02-10"}
    result = tile(orders, "kpi", config, [condition])
    assert rows(result) == [[10.0]]
    assert result["comparison"]["previous"] == 10.0
    assert result["comparison"]["change"] == 0
    assert result["trend"]["rows"]
    year = tile(
        orders,
        "kpi",
        {**config, "compare": {"mode": "previous_year", "column": "day"}},
        [condition],
    )
    assert year["comparison"]["previous"] == 0.0
    assert year["comparison"]["percent"] is None
    assert tile(orders, "kpi", config, None)["comparison"] is None
    assert tile(orders, "kpi", config, None)["note"]


def test_table_tile_aggregated_and_raw(orders: Services) -> None:
    aggregated = tile(
        orders,
        "table",
        {
            "dimensions": [{"column": "region"}],
            "metrics": [{"agg": "sum", "column": "amount"}, {"agg": "count"}],
            "limit": 2,
        },
        None,
    )
    assert [c["name"] for c in aggregated["columns"]] == ["_c0", "_m0", "_m1"]
    assert len(rows(aggregated)) == 2 and aggregated["truncated"] is True
    raw = tile(
        orders,
        "table",
        {
            "dimensions": [{"column": "day"}, {"column": "المنتج"}],
            "sort": {"by": "dimension", "index": 0, "direction": "desc"},
            "limit": 5,
        },
        None,
    )
    assert rows(raw)[0][0] == (START + timedelta(days=119)).isoformat()


def test_saved_query_source(orders: Services) -> None:
    saved = orders.queries.create_saved(
        "north orders", "SELECT region, amount FROM orders WHERE region = 'north'"
    )
    request = TileQuery.model_validate(
        {
            "type": "chart",
            "source": {"kind": "query", "query_id": saved.id},
            "config": {
                "chart": "bar",
                "dimension": {"column": "region"},
                "metrics": [{"agg": "count"}],
            },
            "conditions": [{"column": "amount", "kind": "number_range", "minimum": 5}],
        }
    )
    result = orders.dashboard_queries.run(request)
    assert rows(result)[0][0] == "north"
    columns = orders.dashboard_queries.columns(request.source)
    assert [c["name"] for c in columns] == ["region", "amount"]


def test_invalid_configurations_are_reported(orders: Services) -> None:
    with pytest.raises(InvalidInputError, match="not numeric"):
        tile(
            orders,
            "chart",
            {
                "chart": "bar",
                "dimension": {"column": "region"},
                "metrics": [{"agg": "sum", "column": "region"}],
            },
            None,
        )
    with pytest.raises(InvalidInputError, match="not a date"):
        tile(
            orders,
            "chart",
            {
                "chart": "bar",
                "dimension": {"column": "region", "grain": "month"},
                "metrics": [{"agg": "count"}],
            },
            None,
        )
    with pytest.raises(InvalidInputError, match="not in the data source"):
        tile(
            orders,
            "chart",
            {"chart": "bar", "dimension": {"column": "ghost"}, "metrics": [{"agg": "count"}]},
            None,
        )
    with pytest.raises(NotFoundError):
        orders.dashboard_queries.run(
            TileQuery.model_validate(
                {
                    "type": "chart",
                    "source": {"kind": "table", "table": "main.missing"},
                    "config": {"dimension": {"column": "a"}, "metrics": [{"agg": "count"}]},
                }
            )
        )


def test_results_are_cached_by_table_version(orders: Services) -> None:
    config = {"chart": "bar", "dimension": {"column": "region"}, "metrics": [{"agg": "count"}]}
    first = tile(orders, "chart", config, None)
    assert first["cached"] is False
    assert tile(orders, "chart", config, None)["cached"] is True
    forced = orders.dashboard_queries.run(
        TileQuery.model_validate(
            {"type": "chart", "source": TABLE, "config": config, "force": True}
        )
    )
    assert forced["cached"] is False
    add_table(
        orders,
        "main",
        "orders",
        pa.table(
            {"day": [START], "region": ["north"], "المنتج": ["x"], "amount": [1.0], "units": [1]}
        ),
    )
    changed = tile(orders, "chart", config, None)
    assert changed["cached"] is False
    assert sum(r[1] for r in rows(changed)) == 1


def test_options_for_values_and_ranges(orders: Services) -> None:
    values = orders.dashboard_queries.options(
        OptionsQuery.model_validate({"source": TABLE, "column": "المنتج"})
    )
    assert values["kind"] == "values" and sorted(values["values"]) == sorted(["قهوة", "شاي", "ماء"])
    searched = orders.dashboard_queries.options(
        OptionsQuery.model_validate({"source": TABLE, "column": "region", "search": "OR"})
    )
    assert searched["values"] == ["north"]
    escaped = orders.dashboard_queries.options(
        OptionsQuery.model_validate({"source": TABLE, "column": "region", "search": "%"})
    )
    assert escaped["values"] == []
    dates = orders.dashboard_queries.options(
        OptionsQuery.model_validate({"source": TABLE, "column": "day"})
    )
    assert dates["kind"] == "range" and dates["minimum"] == "2024-01-01"
    limited = orders.dashboard_queries.options(
        OptionsQuery.model_validate({"source": TABLE, "column": "region", "limit": 2})
    )
    assert limited["truncated"] is True and len(limited["values"]) == 2


def test_condition_model_accepts_dates_and_numbers() -> None:
    assert Condition.model_validate({"column": "a", "kind": "date_range", "start": "2024-01-01"})


def test_store_crud_and_duplicate(services: Services) -> None:
    store = services.dashboards
    created = store.create("Sales")
    assert created.spec.tiles == []
    with pytest.raises(ConflictError):
        store.create("sales")
    spec = DashboardSpec.model_validate(
        {
            "tiles": [
                {
                    "id": "a",
                    "type": "text",
                    "layout": {"x": 0, "y": 0, "w": 4, "h": 2},
                    "frontend_only": {"keep": True},
                }
            ]
        }
    )
    updated = store.update(created.id, name="Revenue", spec=spec)
    assert updated.name == "Revenue"
    assert store.get(created.id).spec.model_dump()["tiles"][0]["frontend_only"] == {"keep": True}
    copy = store.duplicate(created.id)
    assert copy.name == "Revenue (copy)"
    assert store.duplicate(created.id).name == "Revenue (copy) 2"
    store.delete(copy.id)
    with pytest.raises(NotFoundError):
        store.get(copy.id)
    duplicate_ids = DashboardSpec.model_validate(
        {
            "tiles": [
                {"id": "a", "type": "text", "layout": {"x": 0, "y": 0, "w": 1, "h": 1}},
                {"id": "a", "type": "text", "layout": {"x": 0, "y": 0, "w": 1, "h": 1}},
            ]
        }
    )
    with pytest.raises(InvalidInputError):
        store.update(created.id, spec=duplicate_ids)


def test_sample_dashboard_runs_every_tile(services: Services) -> None:
    dashboard = create_sample_dashboard(services)
    assert dashboard.name == SAMPLE_NAME
    again = create_sample_dashboard(services)
    assert again.id == dashboard.id
    assert len(services.dashboards.list()) == 1
    kinds = {t.config.chart if t.type == "chart" else t.type for t in dashboard.spec.tiles}
    assert kinds == {
        "text",
        "kpi",
        "table",
        "combo",
        "donut",
        "stacked_bar",
        "line",
        "heatmap",
        "scatter",
        "area",
    }
    conditions = [
        {"column": "order_date", "kind": "date_range", "start": None, "end": None},
        {"column": CATEGORY, "kind": "in", "values": ["أثاث"]},
    ]
    for spec_tile in dashboard.spec.tiles:
        if spec_tile.type == "text" or spec_tile.source is None:
            continue
        result = services.dashboard_queries.run(
            TileQuery.model_validate(
                {
                    "type": spec_tile.type,
                    "source": spec_tile.source.model_dump(),
                    "config": spec_tile.config.model_dump(),
                    "conditions": conditions,
                }
            )
        )
        assert result["rows"], spec_tile.title
    assert services.catalog.get_table("main", SAMPLE_TABLE).row_count == 200_000


def test_cancelled_tile_query(orders: Services) -> None:
    runner = orders.sql
    assert runner.cancel("nothing") is False
    with pytest.raises(QueryCancelledError):

        def work(_: Any) -> None:
            runner._runs["fixed"].cancelled = True
            raise QueryCancelledError()

        runner.run_read("fixed", work)


def test_api_roundtrip_and_export(client: TestClient, tmp_path: Path) -> None:
    created = client.post("/api/dashboards", json={"name": "API board"})
    assert created.status_code == 201
    dashboard_id = created.json()["id"]
    assert client.get("/api/dashboards").json()[0]["tile_count"] == 0
    bad = client.put(f"/api/dashboards/{dashboard_id}", json={"spec": {"tiles": [{"id": "x"}]}})
    assert bad.status_code == 422
    assert client.post(f"/api/dashboards/{dashboard_id}/duplicate").status_code == 201
    assert client.delete(f"/api/dashboards/{dashboard_id}").status_code == 204
    assert client.get(f"/api/dashboards/{dashboard_id}").status_code == 404

    target = tmp_path / "board.png"
    payload = base64.b64encode(b"\x89PNG fake").decode()
    saved = client.post("/api/export/file", json={"path": str(target), "data_base64": payload})
    assert saved.status_code == 200 and target.read_bytes() == b"\x89PNG fake"
    refused = client.post(
        "/api/export/file", json={"path": str(tmp_path / "x.exe"), "data_base64": payload}
    )
    assert refused.status_code == 422
    relative = client.post("/api/export/file", json={"path": "x.png", "data_base64": payload})
    assert relative.status_code == 422


def test_api_sample_and_tile_query(client: TestClient) -> None:
    sample = client.post("/api/dashboards/sample")
    assert sample.status_code == 201
    first_tile = next(t for t in sample.json()["spec"]["tiles"] if t["type"] == "kpi")
    response = client.post(
        "/api/dashboards/query",
        json={"type": "kpi", "source": first_tile["source"], "config": first_tile["config"]},
    )
    assert response.status_code == 200
    assert response.json()["rows"][0][0] > 0
    options = client.post(
        "/api/dashboards/options",
        json={"source": first_tile["source"], "column": "region"},
    )
    assert "Europe" in options.json()["values"]
