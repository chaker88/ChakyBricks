from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Grain = Literal["day", "week", "month", "quarter", "year"]
Aggregation = Literal["sum", "avg", "count", "count_distinct", "min", "max"]
ChartKind = Literal[
    "bar", "stacked_bar", "line", "area", "pie", "donut", "scatter", "heatmap", "combo"
]
TileType = Literal["chart", "kpi", "table", "text"]
ConditionKind = Literal["date_range", "in", "number_range"]
PaletteName = Literal["classic", "sunset", "lagoon", "twilight"]
BackgroundName = Literal["default", "muted", "canvas"]

Identifier = Annotated[str, StringConstraints(min_length=1, max_length=128)]
ItemId = Annotated[str, StringConstraints(min_length=1, max_length=64)]

MAX_LIMIT = 5000
MAX_TABLE_ROWS = 1000


class Flexible(BaseModel):
    """Keeps fields only the frontend understands, so specs round-trip untouched."""

    model_config = ConfigDict(extra="allow")


class Source(Flexible):
    kind: Literal["table", "query"]
    table: str | None = None
    query_id: int | None = None


class FieldRef(Flexible):
    column: Identifier
    grain: Grain | None = None


class NumberFormat(Flexible):
    type: Literal["auto", "number", "compact", "percent", "currency"] = "auto"
    decimals: int | None = Field(default=None, ge=0, le=10)
    currency: str = "USD"


class Metric(Flexible):
    agg: Aggregation
    column: Identifier | None = None
    label: str = ""
    format: NumberFormat = NumberFormat()
    shape: Literal["bar", "line"] | None = None


class Sort(Flexible):
    by: Literal["dimension", "metric"] = "metric"
    index: int = Field(default=0, ge=0, le=32)
    direction: Literal["asc", "desc"] = "desc"


class Compare(Flexible):
    mode: Literal["previous_period", "previous_year"]
    column: Identifier


class TileConfig(Flexible):
    chart: ChartKind = "bar"
    dimension: FieldRef | None = None
    breakdown: FieldRef | None = None
    dimensions: list[FieldRef] = []
    metrics: list[Metric] = []
    sort: Sort | None = None
    limit: int | None = Field(default=None, ge=1, le=MAX_LIMIT)
    compare: Compare | None = None
    trend: FieldRef | None = None
    text: str = ""


class Layout(BaseModel):
    x: int = Field(ge=0, le=47)
    y: int = Field(ge=0, le=10_000)
    w: int = Field(ge=1, le=48)
    h: int = Field(ge=1, le=200)


class TileSpec(Flexible):
    id: ItemId
    type: TileType
    title: str = Field(default="", max_length=200)
    layout: Layout
    source: Source | None = None
    config: TileConfig = TileConfig()


class FilterSpec(Flexible):
    id: ItemId
    type: Literal["date_range", "select", "number_range"]
    label: str = Field(default="", max_length=120)
    source: Source
    column: Identifier
    multi: bool = True
    default: Any = None


class Theme(Flexible):
    palette: PaletteName = "classic"
    background: BackgroundName = "default"


class DashboardSpec(Flexible):
    version: int = 1
    theme: Theme = Theme()
    refresh_seconds: int | None = Field(default=None, ge=5, le=86_400)
    cross_filter: bool = True
    filters: list[FilterSpec] = []
    tiles: list[TileSpec] = []


class Condition(BaseModel):
    """One active filter or cross-filter, as sent with a tile query."""

    column: Identifier
    kind: ConditionKind
    start: str | None = None
    end: str | None = None
    values: list[str | int | float | bool | None] = Field(default=[], max_length=500)
    minimum: float | None = None
    maximum: float | None = None
    grain: Grain | None = None


class TileQuery(BaseModel):
    type: Literal["chart", "kpi", "table"]
    source: Source
    config: TileConfig
    conditions: list[Condition] = Field(default=[], max_length=64)
    query_id: str = Field(default="", max_length=64)
    force: bool = False


class OptionsQuery(BaseModel):
    source: Source
    column: Identifier
    search: str = Field(default="", max_length=200)
    limit: int = Field(default=200, ge=1, le=1000)
    query_id: str = Field(default="", max_length=64)
