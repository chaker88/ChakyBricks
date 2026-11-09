# Known limitations

ChakyBricks 1.0 is a focused, single-user desktop tool. These are the things it does not do, or does with restrictions.

## Platform and installation

- **Windows only.** There is no macOS or Linux build yet.
- **Unsigned installer.** Windows SmartScreen shows "Windows protected your PC"; choose **More info → Run anyway**.
- **Single user, single machine.** There are no accounts, sharing, teams or cloud storage connectors. Open the same workspace from one ChakyBricks at a time.

## Jobs

- **Jobs run only while ChakyBricks is running.** There is no background service. Turn on **Settings → Background → Keep running in the background** to keep jobs going after you close the window. Runs that were due while the app was not running are skipped, not made up later, and a run interrupted by closing the app is marked Failed. See [Jobs and background mode](jobs.md).

## SQL

- **Limited writes.** Only `CREATE [OR REPLACE] TABLE … AS SELECT`, `INSERT INTO … SELECT|VALUES`, `DROP TABLE` and `ALTER TABLE … RENAME TO` write data. `UPDATE`, `DELETE`, `TRUNCATE`, `COPY`, views, schemas, temporary tables and plain `CREATE TABLE` are rejected with a message. See [SQL editor](sql-editor.md#writing-data).
- **No SQL time travel syntax.** Use a table's **History** tab or `cb.table(name, version=n)`.

## Data

- **Excel import** is limited to `.xlsx` files of about 50 MB; use CSV or Parquet for anything larger.
- **Result grids** load the first rows of a result (10,000 by default in the SQL editor, 1,000 in notebooks and dashboard tables) together with the exact total; exports contain everything.

## Memory and disk

- **Dashboards load their tiles one query at a time** by default, which keeps memory low on very large tables. You can raise this in Settings.
- **Query temporary space is capped** at the smaller of 50 GB and half of the free space on the workspace's drive. A query that needs more fails with *"Not enough disk space for this query"*.

## Python packages

- **Pinned core packages.** `duckdb`, `deltalake`, `pyarrow`, `polars`, `numpy`, `pandas` and `ipykernel` stay at the versions that ship with ChakyBricks so that `cb` keeps working. Installing a conflicting version is refused with an explanation.
- A package installed from **Settings → Python packages** is importable in an already running notebook only after you restart its kernel. (`%pip install` inside a notebook works immediately for packages the kernel has not imported yet.)
- Installing packages needs an internet connection.

Found something else? Please [open an issue](https://github.com/chaker88/ChakyBricks/issues).
