import re
from dataclasses import dataclass
from enum import StrEnum

import duckdb

from chakybricks.catalog import parse_full_name
from chakybricks.errors import InvalidInputError

READ_TYPES = {duckdb.StatementType.SELECT, duckdb.StatementType.EXPLAIN}
WRITE_TYPES = {
    duckdb.StatementType.CREATE,
    duckdb.StatementType.INSERT,
    duckdb.StatementType.DROP,
    duckdb.StatementType.ALTER,
}

_IDENT = r'(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)'
_NAME = rf"(?P<name>{_IDENT}(?:\s*\.\s*{_IDENT})?)"
_TAIL = r"\s*(?:;[\s\S]*)?$"
_LEADING = re.compile(r"^(?:\s+|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*")
_FLAGS = re.IGNORECASE | re.DOTALL

_CTAS = re.compile(
    rf"^CREATE\s+(?P<replace>OR\s+REPLACE\s+)?TABLE\s+(?P<ine>IF\s+NOT\s+EXISTS\s+)?"
    rf"{_NAME}\s+AS\s+(?P<query>.+)$",
    _FLAGS,
)
_CREATE_TABLE = re.compile(
    r"^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP|TEMPORARY\s+)?\s*TABLE\b", _FLAGS
)
_INSERT = re.compile(rf"^INSERT\s+INTO\s+{_NAME}\s+(?P<query>.+)$", _FLAGS)
_DROP = re.compile(rf"^DROP\s+TABLE\s+(?P<ie>IF\s+EXISTS\s+)?{_NAME}{_TAIL}", _FLAGS)
_RENAME = re.compile(
    rf"^ALTER\s+TABLE\s+(?P<ie>IF\s+EXISTS\s+)?{_NAME}\s+RENAME\s+TO\s+(?P<new>{_IDENT}){_TAIL}",
    _FLAGS,
)

SUPPORTED_WRITES = (
    "CREATE [OR REPLACE] TABLE … AS SELECT, INSERT INTO … SELECT, DROP TABLE and "
    "ALTER TABLE … RENAME TO"
)


class WriteAction(StrEnum):
    CREATE = "create"
    CREATE_IF_NOT_EXISTS = "create_if_not_exists"
    REPLACE = "replace"
    APPEND = "append"
    DROP = "drop"
    DROP_IF_EXISTS = "drop_if_exists"
    RENAME = "rename"
    RENAME_IF_EXISTS = "rename_if_exists"


@dataclass(frozen=True)
class WriteStatement:
    action: WriteAction
    schema: str
    table: str
    query: str | None = None
    new_name: str | None = None

    @property
    def full_name(self) -> str:
        return f"{self.schema}.{self.table}"


@dataclass(frozen=True)
class Statement:
    sql: str
    type: duckdb.StatementType
    write: WriteStatement | None

    @property
    def is_select(self) -> bool:
        return self.type == duckdb.StatementType.SELECT


def parse_statements(sql: str) -> list[Statement]:
    """Splits SQL into statements; reads run in DuckDB, supported writes go through Delta."""
    try:
        raw = duckdb.extract_statements(sql)
    except duckdb.Error as exc:
        raise InvalidInputError(str(exc)) from exc
    if not raw:
        raise InvalidInputError("Enter a query to run")
    statements = []
    for statement in raw:
        text = str(statement.query)
        if statement.type in READ_TYPES:
            statements.append(Statement(text, statement.type, None))
        elif statement.type in WRITE_TYPES:
            statements.append(Statement(text, statement.type, parse_write(text)))
        else:
            raise InvalidInputError(_unsupported(statement.type.name.replace("_", " ")))
    return statements


def parse_write(sql: str) -> WriteStatement:
    text = _LEADING.sub("", sql)
    if match := _CTAS.match(text):
        schema, table = _name(match["name"])
        if match["replace"] and match["ine"]:
            raise InvalidInputError("Use either OR REPLACE or IF NOT EXISTS, not both")
        action = (
            WriteAction.REPLACE
            if match["replace"]
            else WriteAction.CREATE_IF_NOT_EXISTS
            if match["ine"]
            else WriteAction.CREATE
        )
        return WriteStatement(action, schema, table, query=_select(match["query"]))
    if _CREATE_TABLE.match(text):
        raise InvalidInputError(
            "CREATE TABLE needs a query: tables are Delta tables created from data, e.g. "
            "CREATE TABLE sales_2024 AS SELECT * FROM sales WHERE year = 2024. "
            "Temporary tables and column definitions are not supported."
        )
    if match := _INSERT.match(text):
        schema, table = _name(match["name"])
        query = match["query"]
        if re.match(r"^\(\s*(?!SELECT|WITH|FROM|VALUES|\()", query, re.IGNORECASE):
            raise InvalidInputError(
                "INSERT column lists are not supported; select the columns in the target "
                "table's order instead: INSERT INTO t SELECT a, b, c FROM …"
            )
        return WriteStatement(WriteAction.APPEND, schema, table, query=_select(query))
    if match := _DROP.match(text):
        schema, table = _name(match["name"])
        action = WriteAction.DROP_IF_EXISTS if match["ie"] else WriteAction.DROP
        return WriteStatement(action, schema, table)
    if match := _RENAME.match(text):
        schema, table = _name(match["name"])
        action = WriteAction.RENAME_IF_EXISTS if match["ie"] else WriteAction.RENAME
        return WriteStatement(action, schema, table, new_name=_unquote(match["new"]))
    keyword = " ".join(text.split()[:2]).upper() or "This statement"
    raise InvalidInputError(_unsupported(keyword))


def result_query(sql: str) -> str:
    """The statement whose result the editor shows: the last one, which must be a SELECT."""
    last = parse_statements(sql)[-1]
    if not last.is_select:
        raise InvalidInputError("The last statement must be a SELECT query")
    return last.sql


def _select(query: str) -> str:
    try:
        statements = duckdb.extract_statements(query)
    except duckdb.Error as exc:
        raise InvalidInputError(f"Invalid query: {exc}") from exc
    if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
        raise InvalidInputError("Expected a SELECT query after AS / INSERT INTO table")
    return str(statements[0].query)


def _unquote(identifier: str) -> str:
    identifier = identifier.strip()
    if identifier.startswith('"'):
        return identifier[1:-1].replace('""', '"')
    return identifier


def _name(reference: str) -> tuple[str, str]:
    parts = [
        _unquote(p) for p in re.split(rf"\s*\.\s*(?={_IDENT}$)", reference.strip(), maxsplit=1)
    ]
    return parse_full_name(".".join(parts))


def _unsupported(kind: str) -> str:
    return (
        f"{kind} statements are not supported in the SQL editor. Supported writes: "
        f"{SUPPORTED_WRITES}. Tables are Delta tables; update data by rewriting it, e.g. "
        "CREATE OR REPLACE TABLE t AS SELECT … FROM t WHERE …"
    )
