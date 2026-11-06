from pathlib import Path


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.warehouse = self.root / "warehouse"
        self.notebooks = self.root / "notebooks"
        self.tmp = self.root / "tmp"
        self.meta_db = self.root / "meta.db"

    def ensure(self) -> "Workspace":
        for path in (self.warehouse, self.notebooks, self.tmp):
            path.mkdir(parents=True, exist_ok=True)
        return self

    def table_location(self, schema: str, table: str) -> str:
        return f"{schema}/{table}"

    def table_path(self, location: str) -> Path:
        return self.warehouse / location
