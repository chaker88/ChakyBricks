# Jobs and background mode

Jobs run a **notebook** or a **saved query** on a schedule: refresh a table every morning, rebuild a summary every hour, and so on. Open the list with ++ctrl+6++.

!!! warning "Jobs only run while ChakyBricks is running"
    There is no background service. A job runs only while the ChakyBricks app is running — with its window open, or, if you turn it on, in the system tray (see [Background mode](#background-mode)). Runs that were due while the app was closed are **skipped, not made up later**.

## Create a job

Click **New job**, or use **Schedule…** in a notebook's toolbar or in a saved query's ⋯ menu (the dialog opens pre-filled). Choose:

- a **name**,
- **what to run**: a notebook or a saved query,
- a **schedule**, with a preview of the next run times.

| Schedule | Meaning |
| --- | --- |
| Manual only | Runs only when you press **Run now** |
| Every few minutes or hours | An interval such as every 15 minutes or every 2 hours |
| Every day | At a time you choose |
| Certain weekdays | At a time, on the weekdays you select |
| Once a month | On a day of the month (1–31), at a time you choose |
| Custom (cron) | A five-field cron expression, for example `0 6 * * mon-fri` for 06:00 on weekdays |

Times use your computer's local time zone. An invalid cron expression shows an error in the dialog.

## What a run does

- **Saved query:** runs the query with the same engine as the SQL editor, so a job can refresh a table with `CREATE OR REPLACE TABLE … AS SELECT …`. The log shows the result of the write.
- **Notebook:** runs every code cell in order in a **private kernel**, so a notebook you have open is not disturbed and the `.ipynb` file is never modified. Python and SQL cells work; Markdown cells are skipped. The log records output, results and errors. If a cell fails, the run is marked **Failed** with *"Cell N failed: …"* and the cells after it do not run.

While a job runs, the **Jobs** list shows it as running; **Cancel run** on the job's page stops a long query or cell.

## Run history

Click a job to see its **run history** — status, how it was triggered (manual or schedule), start time and duration — and select a run to read its **log**. The log follows a running job live. The last 200 runs of each job are kept (and very long logs are shortened).

Statuses: **Running**, **Succeeded**, **Failed**, **Cancelled** and **Skipped**.

- A scheduled run that is due while the previous run of the same job is still going is recorded as **Skipped**.
- If you close ChakyBricks while a job is running, that run is marked **Failed** with a note that the app was closed.

## Managing jobs

- The switch on each job **pauses** (disables) or enables just that job. A paused job keeps its history and does not run on schedule.
- **Run now** starts a run immediately, whatever the schedule.
- **Edit…** changes the name, target or schedule (the next run time updates); **Delete…** removes the job **and its history**, but not the notebook or query it runs.
- Renaming a notebook updates the jobs that use it. If you delete a notebook or saved query that a job uses, the job's next run fails with a clear message.

## Background mode

In **Settings → Background** there are two options, **both off by default**:

- **Keep running in the background when the window is closed.** Closing the window then hides it instead of quitting, and ChakyBricks stays in the system tray (the notification area), so scheduled jobs keep running.
- **Start with the system, minimized to the tray.** ChakyBricks starts when you sign in to Windows, without opening its window. The tray icon is available whenever either option is on.

The first time you turn one on, a notice explains that **jobs only run while ChakyBricks is running**.

The tray icon has a menu:

| Menu item | What it does |
| --- | --- |
| **Open ChakyBricks** | Shows the window (clicking the icon does the same) |
| **Pause all jobs** | A check mark toggles it. While paused, no job runs on schedule; **Run now** still works. The Jobs page shows a banner with **Resume all**. Pausing is not remembered across restarts. |
| **Quit** | Exits ChakyBricks completely, stopping the backend and any running jobs |

If you start ChakyBricks a second time while it is already running, the existing window is shown instead of opening a second copy. Turn the options off again and the tray icon disappears (and the sign-in entry is removed), with closing the window quitting the app again.
