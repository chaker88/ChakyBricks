import duckdb

from chakybricks.errors import InvalidInputError

READ_ONLY_TYPES = {duckdb.StatementType.SELECT, duckdb.StatementType.EXPLAIN}


def parse_statements(sql: str) -> list[duckdb.Statement]:
    """Splits SQL into statements and rejects anything that is not a read-only query."""
    try:
        statements = duckdb.extract_statements(sql)
    except duckdb.Error as exc:
        raise InvalidInputError(str(exc)) from exc
    if not statements:
        raise InvalidInputError("Enter a query to run")
    for statement in statements:
        if statement.type not in READ_ONLY_TYPES:
            kind = statement.type.name.replace("_", " ")
            raise InvalidInputError(
                f"{kind} statements are not supported in the SQL editor. Queries are read-only; "
                "use “Save as table” to create a table from a query."
            )
    return statements


def result_query(sql: str) -> str:
    """The statement whose result the editor shows: the last one, which must be a SELECT."""
    last = parse_statements(sql)[-1]
    if last.type != duckdb.StatementType.SELECT:
        raise InvalidInputError("The last statement must be a SELECT query")
    return str(last.query)
