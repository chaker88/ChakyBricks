# Getting started

This page takes you from the installer to your first query, notebook and dashboard in about ten minutes.

## Install

1. [Download the installer](https://github.com/chaker88/ChakyBricks/releases/latest/download/ChakyBricks_x64-setup.exe) (`ChakyBricks_x64-setup.exe`) and run it. Older versions and release notes are under [all releases](https://github.com/chaker88/ChakyBricks/releases).
2. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. The installer is not code-signed yet.
3. Start **ChakyBricks** from the Start menu.

ChakyBricks needs Windows 10 or 11 (64-bit) with WebView2, which is part of current Windows. It ships its own Python, so you don't need to install anything else. See [Known limitations](limitations.md) for what version 1.0 does not do.

## The window

A narrow rail on the left switches between the main areas. The same shortcuts work from anywhere:

| Area | Shortcut | What it is |
| --- | --- | --- |
| Home | ++ctrl+1++ | Quick actions and recent tables |
| Catalog | ++ctrl+2++ | Your schemas and tables |
| SQL | ++ctrl+3++ | SQL editor |
| Notebooks | ++ctrl+4++ | Python, SQL and Markdown notebooks |
| Dashboards | ++ctrl+5++ | Dashboards |
| Jobs | ++ctrl+6++ | Scheduled notebooks and queries |
| Settings | ++ctrl+7++ | Preferences, packages and shortcuts |

Press ++ctrl+k++ for the command palette: it jumps to any area, starts an import and opens any table. The theme (light, dark or follow Windows) is in **Settings**.

## Your first table

1. On **Home**, choose **Import data** (or use the button on the **Catalog** page).
2. Pick a CSV, Parquet, JSON or Excel file. The wizard shows a preview and the detected column types; adjust them if needed, then start the import. See [Importing data](importing-data.md).
3. The table appears in the **Catalog**, under the `main` schema unless you chose another one.

!!! tip "Try it without your own data"
    Open **Dashboards** and click **Sample dashboard**. ChakyBricks generates a 200,000-row sales table called `main.demo_sales` and a ready-made dashboard on it, which is a good way to try SQL, notebooks and dashboards right away.

## Your first query

Open **SQL** (++ctrl+3++) and run:

```sql
SELECT region, count(*) AS orders
FROM demo_sales
GROUP BY region
ORDER BY orders DESC
```

Press ++ctrl+enter++ to run. Tables in the `main` schema can be used without a schema prefix; tables in other schemas are written `schema.table`. More in [SQL editor](sql-editor.md).

## Your first notebook

Open **Notebooks**, create a notebook and run a Python cell:

```python
df = cb.sql("SELECT region, sum(revenue) AS revenue FROM demo_sales GROUP BY 1")
df
```

`cb` is available in every notebook without importing it. `cb.sql` returns a Polars DataFrame, which the notebook shows as a table. See [Python notebooks](notebooks.md).

## Where your data lives

Everything is stored in your **workspace folder**, by default `%APPDATA%\ChakyBricks`. You can change it in **Settings → Workspace folder**. See [Settings and Python packages](settings.md#where-your-data-is-stored).
