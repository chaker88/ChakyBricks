# Importing data

ChakyBricks stores every table as a **Delta table** in your workspace. Importing converts a file into such a table; the original file is never changed or needed afterwards.

## Supported files

| Format | Extensions |
| --- | --- |
| CSV | `.csv`, `.txt` |
| Tab-separated | `.tsv`, `.tab` |
| Parquet | `.parquet`, `.pq` |
| JSON and newline-delimited JSON | `.json`, `.ndjson`, `.jsonl` |
| Excel | `.xlsx` (files up to 50 MB) |

CSV, TSV and Parquet files of several gigabytes are fine: the import streams the data through DuckDB into Delta in the background, so it does not need to fit in memory and does not block the app.

## The import wizard

Start it from **Home → Import data**, from the **Catalog**, or from the command palette (++ctrl+k++). It has three steps: pick a file, configure the import, and watch the progress.

**Configure** lets you set:

- **Schema** and **Table name** — where the table goes. You can create a new schema on the spot. Names are lowercase letters, digits and underscores.
- **Table already exists** — if the name is taken, choose **Append rows** or **Replace table**.
- **Partition by** — optional; pick a column with few distinct values, such as a date or a region, to split the table into folders. Partitioning is not available when appending.
- **Delimiter** and **First row is a header** — for CSV and TSV files (the delimiter can be auto-detected, or set to comma, semicolon, tab or pipe).
- **Columns** — every column can be included or left out, renamed and given another type. The types offered are `VARCHAR`, `BOOLEAN`, `INTEGER`, `BIGINT`, `DOUBLE`, `DECIMAL(18,2)`, `DATE`, `TIMESTAMP` and `TIMESTAMP WITH TIME ZONE`.
- **Preview** — the first rows are shown with your settings applied, and update as you change them.

### Column names

Column names are cleaned so they work unquoted in both SQL and Python: letters of any script (Arabic, accented Latin and others), digits and underscores are kept, everything else becomes an underscore, names are lowercased, and duplicates get a suffix. A name that starts with a digit, or that is a reserved word, gets a `c_` prefix. You can still edit every name in the wizard.

### Progress and cancel

The progress step shows the rows written so far. You can close the dialog and keep working: a notification appears when the import finishes. **Cancel** stops the import; a table that was being created is removed again. Only one import runs at a time; others wait in the queue.

## The catalog

The **Catalog** page lists schemas, tables and columns with type icons. Click a table to open its page:

- **Schema** — column names and types.
- **Sample data** — the first rows.
- **History** — the Delta version history (what was written, when). Pick an older version to see a sample of the table as it was then (time travel).
- **Details** — full name, location in the workspace, where it was imported from, creation and update times, and the format (Delta Lake).

From the table page you can **Open in SQL**, **Open in notebook**, rename the table, or drop it. Dropping deletes the data.

## Time travel

Every write creates a new Delta version. In a notebook, read an older version with `cb.table("sales", version=3)`; in the app, use the **History** tab. See the [`cb` reference](notebooks.md#cb-reference).

## Creating tables another way

You can also create tables from queries: run `CREATE TABLE … AS SELECT` in the [SQL editor](sql-editor.md), use **Save as table** on a result, or call `cb.save(df, "name")` in a [notebook](notebooks.md).
