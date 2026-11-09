# Settings and Python packages

Open **Settings** with ++ctrl+7++.

## Settings

| Setting | What it does |
| --- | --- |
| **Theme** | Light, Dark, or System (follows Windows). |
| **Workspace folder** | Where tables, notebooks and metadata are stored. Changing it switches to the new folder; existing data stays in the old folder. |
| **Memory limit** | The most memory the query engine may use before spilling to disk. Default: 60% of your RAM; you can enter another value in GB. |
| **Default row limit** | How many rows the SQL editor's grid loads (100 to 1,000,000; default 10,000). The total row count is always exact and exports always include every row. |
| **Notebook kernel memory** | The share of the memory limit each notebook kernel's query engine may use: 25%, 50% (default), 75% or 100%. Applies to kernels started afterwards. |
| **Dashboard queries at once** | How many tile queries a dashboard runs at the same time (1 to 4; default 1). Lower uses less memory; higher can load dashboards with many small tiles faster. |
| **Background** | Keep running in the tray after closing the window, and start with Windows. Both are off by default. See [Jobs and background mode](jobs.md#background-mode). |
| **Python packages** | Opens the packages page, described below. |
| **Engine** | Shows the version and local address of the backend process. |
| **About** | Version, author, license and third-party notices. |

Below the list you will find the **Keyboard shortcuts** reference and **Running kernels**: every notebook kernel that is running, with its memory use and a **Shut down** button.

## Where your data is stored

By default in `%APPDATA%\ChakyBricks`; choose another folder in Settings if you prefer another drive.

| Path in the workspace | Contents |
| --- | --- |
| `warehouse\<schema>\<table>\` | Delta tables (an open format other tools can read) |
| `notebooks\` | your `.ipynb` notebook files |
| `meta.db` | the catalog, saved queries, query history, dashboards, jobs and run history |
| `tmp\` | temporary spill files of large queries |
| `.venv\` | the Python environment used by notebooks, with the packages you installed |

To back up your work, copy the workspace folder while ChakyBricks is closed.

## Python packages

Notebooks run in a Python environment that belongs to your workspace. It comes with these packages, available offline:

- **Data:** pandas, polars, numpy, pyarrow, duckdb, deltalake, scipy, scikit-learn, openpyxl
- **Plotting:** matplotlib, plotly
- **Notebooks:** ipykernel, IPython and their dependencies

**Settings → Python packages → Manage packages** lists the installed packages, split into the defaults that ship with the app and the ones you installed.

- **Install** one or more packages by name, separated by spaces (versions such as `lightgbm==4.5.0` are accepted). This needs an internet connection, and the packages are installed into your workspace environment only.
- **Uninstall** packages you installed. The default packages cannot be uninstalled.
- **Reset to defaults** shuts down the kernels and recreates the environment, removing everything you installed.

You can also install from inside a notebook with `%pip install name` or `!pip install name`. A package that is new to the kernel can be imported right away; if you changed a package that was already imported, restart the kernel.

!!! info "Protected packages"
    `duckdb`, `deltalake`, `pyarrow`, `polars`, `numpy`, `pandas` and `ipykernel` are pinned to the versions that ship with ChakyBricks, because the `cb` helper depends on them. Installing a different version of one of these, or a package that would require one, is refused, and the output explains why.

A package installed from the packages page (rather than inside a running notebook) is only importable after you restart that notebook's kernel; the page tells you so.
