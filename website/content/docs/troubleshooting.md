# Troubleshooting and FAQ

## Installing and starting

**Windows says "Windows protected your PC".**
The installer is not code-signed yet, so SmartScreen warns about it. Click **More info**, then **Run anyway**.

**The first notebook takes a while to start.**
The first time a workspace runs a notebook, ChakyBricks creates the workspace's Python environment, which takes a few seconds. Later starts are faster.

**I started ChakyBricks twice and only one window appears.**
That is intended: starting it again shows the window that is already running. If it was hidden in the tray, use the tray icon's **Open ChakyBricks**.

**The window is gone but ChakyBricks is still running.**
You turned on **Settings → Background → Keep running in the background**. Open it again from the tray icon, or choose **Quit** in the tray menu to exit completely, or turn the option off.

## Importing

**"Unsupported file type".**
Supported are `.csv`, `.txt`, `.tsv`, `.tab`, `.parquet`, `.pq`, `.json`, `.ndjson`, `.jsonl` and `.xlsx`. For other formats, convert the file to CSV or Parquet first.

**An Excel file is rejected.**
Excel import is limited to files of about 50 MB. Export the sheet to CSV from Excel instead; CSV imports stream and have no such limit.

**Column names changed during import.**
Names are cleaned so they work in both SQL and Python (lowercase letters of any script, digits and underscores; a `c_` prefix for names that start with a digit or are reserved words). You can rename every column in the wizard.

**Dates or numbers were imported as text.**
Change the column's type in the wizard's configure step; the preview updates immediately.

## Queries and memory

**A query fails with "Not enough disk space for this query".**
Big sorts, joins and aggregations spill to the `tmp` folder of your workspace when they exceed the memory limit. ChakyBricks caps that spill space at the smaller of 50 GB and half of the free space on the workspace's drive. Free up disk space, add filters or aggregate earlier, or move the workspace to a drive with more room (**Settings → Workspace folder**).

**A query is slow or uses a lot of memory.**
Raise **Memory limit** in Settings if you have RAM to spare, select only the columns you need, filter early, and avoid `ORDER BY` on huge results. Dashboards load their tiles one query at a time by default for this reason.

**My SQL statement is "not supported".**
The editor runs `SELECT`, `EXPLAIN`, `DESCRIBE`, `SUMMARIZE` and four writes: `CREATE [OR REPLACE] TABLE … AS SELECT`, `INSERT INTO … SELECT|VALUES`, `DROP TABLE` and `ALTER TABLE … RENAME TO`. See [SQL editor](sql-editor.md#writing-data).

**The result grid shows fewer rows than the total.**
By design: the grid loads the first rows (10,000 by default, see **Default row limit** in Settings) and shows the exact total. **Export** writes every row.

## Notebooks and packages

**A package I installed cannot be imported.**
If you installed it from **Settings → Python packages**, restart the notebook's kernel. If you used `%pip install` and the package was already imported, restart the kernel too.

**Installing a package is refused.**
`duckdb`, `deltalake`, `pyarrow`, `polars`, `numpy`, `pandas` and `ipykernel` are pinned to the versions bundled with the app so `cb` keeps working. The output explains which requirement conflicted.

**Installing a package fails.**
Package installs download from the internet, so they need a connection (the bundled packages work offline).

**I want a clean environment.**
**Settings → Python packages → Reset to defaults** shuts down the kernels and recreates the workspace environment, removing the packages you installed.

**A notebook runs out of memory.**
Each kernel's query engine is limited (50% of the memory limit by default), but DataFrames in Python use extra memory. Aggregate in SQL, use `cb.table(...)` lazy frames instead of `.to_pandas()` on large tables, or shut down kernels you don't need (**Settings → Running kernels**).

## Jobs

**A job did not run.**
Jobs run only while ChakyBricks is running. Check that the app (or its tray icon) was running at the scheduled time, that the job's switch is on, and that **Pause all jobs** is not active. Runs missed while the app was closed are not made up. A run that was due while the previous one was still going shows as **Skipped**.

**A run says it failed because ChakyBricks was closed.**
The app was closed while the job was running.

**A job fails with a message about a missing notebook or query.**
The notebook or saved query it points to was deleted or renamed outside the app. Edit the job and choose its target again.

## FAQ

**Is ChakyBricks free?**
Yes. It is open source under the Apache License 2.0.

**Does it need the internet?**
No. Everything, including notebooks with the bundled packages, works offline. Only installing additional Python packages needs a connection.

**Where is my data, and does it leave my computer?**
In your workspace folder (by default `%APPDATA%\ChakyBricks`); see [Settings](settings.md#where-your-data-is-stored). ChakyBricks has no cloud component and does not upload your data.

**Can other tools read my tables?**
Tables are standard Delta Lake tables with Parquet files, which Spark, Polars, DuckDB and many other tools can read. Don't modify the files behind ChakyBricks's back while it is running.

**Which Windows versions are supported?**
Windows 10 and 11, 64-bit, with WebView2.

**Is there a Mac or Linux version?**
Not yet. Only Windows is built and tested; a Linux version is planned for the future.

**Can I use my own Python or my own Jupyter?**
Notebooks always use the Python that ships with ChakyBricks, extended by the packages you install into the workspace environment. The notebook files are plain `.ipynb` files that you can open elsewhere, but the `cb` helper only exists inside ChakyBricks.

**How do I report a problem or suggest something?**
Open an issue at <https://github.com/chaker88/ChakyBricks/issues>.
