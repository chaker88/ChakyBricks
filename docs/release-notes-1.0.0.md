# ChakyBricks 1.0.0

ChakyBricks is an offline desktop lakehouse for Windows. Import data files of up to about 10 GB, explore them with SQL, work with them in Python notebooks, build dashboards and schedule jobs. Everything runs on your own machine: no server, no account, no internet connection needed.

## Highlights

- **Catalog and import.** A streaming import wizard turns CSV, Parquet, JSON and Excel files into Delta tables, with type overrides, partitioning and a live preview. Arabic and other non-Latin column names work. Tables keep a version history and support time travel.
- **SQL editor.** DuckDB with autocomplete for tables and columns, a virtualized result grid, charts, column statistics, saved queries, history and export to CSV or Parquet. `CREATE TABLE … AS SELECT`, `INSERT INTO … SELECT`, `DROP TABLE` and `ALTER TABLE … RENAME TO` write Delta tables.
- **Python notebooks.** Jupyter-compatible `.ipynb` files with Python, SQL and Markdown cells; Polars, pandas, Plotly and matplotlib included; `%pip install` for more packages; the `cb` helper (`cb.sql`, `cb.table`, `cb.save`, `cb.tables`).
- **Dashboards.** A no-code tile builder (charts, KPIs, tables, text), filters, cross-filtering, palettes and PNG/PDF export, plus a ready-made sample dashboard.
- **Jobs.** Run a notebook or a saved query on a schedule (interval, daily, weekly, monthly or cron), with run history, live logs, Run now and Cancel.
- **Background mode (optional).** Keep ChakyBricks in the system tray after closing the window, and optionally start it with Windows, minimized to the tray. Both are off by default.
- **Large data.** Tested with an 88-million-row, 10 GB CSV on a 16 GB machine: the import took about a minute, and queries and dashboards stayed within the memory limit. Details: [load-test.md](load-test.md).

## Requirements

- Windows 10 or 11, 64-bit, with WebView2 (already part of current Windows 10/11).
- About 1 GB of disk space for the application (the installer is about 194 MB), plus room for your data and for temporary query files.
- 8 GB of RAM or more is recommended for large datasets; 16 GB for files around 10 GB.

## Install

1. Download `ChakyBricks_1.0.0_x64-setup.exe` from the release assets and run it.
2. The installer is not code-signed yet, so Windows may show **"Windows protected your PC"** (SmartScreen). Choose **More info**, then **Run anyway**.
3. Start **ChakyBricks** from the Start menu.

The first notebook in a workspace takes a few seconds longer to start while its Python environment is created.

## Known limitations

- **Windows only.** There is no macOS or Linux build yet.
- **Unsigned installer.** Expect the SmartScreen warning described above.
- **Jobs run only while ChakyBricks is running.** There is no background service. Turn on Settings → Background → "Keep running in the background" to keep jobs going after you close the window. Runs that were due while the app was not running are skipped, not made up later, and a run interrupted by closing the app is marked Failed.
- **Single user, single machine.** No accounts, sharing or cloud storage connectors.
- **Limited SQL writes.** Only the four forms listed above are supported; `UPDATE`, `DELETE`, `COPY`, views, temp tables and plain `CREATE TABLE` are rejected with a message.
- **Excel import** is limited to files of about 50 MB.
- **Dashboards load their tiles one query at a time** by default, which keeps memory low on very large tables (first load of a 10-tile dashboard on 88 M rows: about 21 s, instantly on repeat). You can raise this in Settings.
- **Query temporary space is capped** at the smaller of 50 GB and half of the free space on the workspace's drive; a query that needs more fails with "Not enough disk space for this query".
- **Pinned core packages.** `duckdb`, `deltalake`, `pyarrow`, `polars`, `numpy`, `pandas` and `ipykernel` stay at the bundled versions so `cb` keeps working; installing a conflicting version is refused with an explanation.
- A package installed from Settings → Packages is importable in an already running notebook only after restarting its kernel (`%pip install` inside a notebook works immediately for new packages).
- Features are hand-tested on Windows; the tray, start-with-Windows and some dashboard editing paths have had less testing than the rest. Please report problems at <https://github.com/chaker88/ChakyBricks/issues>.

## License

Apache License 2.0. Created by Chaker Saidi. Third-party notices are installed next to the app (`THIRD_PARTY_NOTICES.txt`).
