# WO Summary — Google Sheets automation

Automates the workflow you described: pull timesheet data from several
separate Google Sheets (one per squad), combine them into one place, and
run the same CAPEX/OPEX/Non-Charge classification as the `index.html` web
tool — but living inside Google Sheets, with real colored cells, and no
manual copy-paste between files.

This reuses the exact same classification rules as the web tool (same
category-normalization, same cross-tab/percent-table math) — verified by
`tests/run-tests.js` against the identical sample dataset used to test
`index.html`.

## What it does

Click **WO Summary ▸ Run Now** in your master Sheet, and the script:

1. Reads the list of source spreadsheet URLs from the **Config** tab.
2. Opens each one and reads its timesheet rows (same layout as
   `krungsri.xlsx`: row 3 onward, columns A–AJ), stopping at the first
   blank row per source — no 11-row cap.
3. Reads your **WO Mapping** tab (WO No. → CAPEX / OPEX / Non Charge).
4. Writes every combined row into **Combined Raw**, tagged with which
   source file it came from.
5. Classifies every row and writes **Table 1** (Squad × WO cross-tab,
   grouped and colored by category) and **Table 2** (%CAPEX/%OPEX per
   squad) — with real cell background colors, not just text.
6. Shows a popup listing any unmapped WO numbers or unreadable rows —
   nothing is silently dropped or miscategorized.

## One-time setup

1. **Create (or pick) your master Google Sheet.** This is the one file
   you'll open and click "Run Now" in — it doesn't need to hold any
   timesheet data itself.

2. **Add a `Config` tab** with this header row, then one row per source
   squad:

   | Squad/Label | Sheet URL | Tab Name (optional) |
   |---|---|---|
   | KSB_Elephant | https://docs.google.com/spreadsheets/d/xxxxx/edit | |
   | KSB_Orca | https://docs.google.com/spreadsheets/d/yyyyy/edit | Sheet1 |

   Leave "Tab Name" blank to use each file's first sheet. Adding a new
   squad later is just adding one more row here — no code changes.

3. **Add a `WO Mapping` tab** with this header row, then your mapping:

   | WO No. | Category | WO Name |
   |---|---|---|
   | CAPEX-001 | CAPEX | ONE Corporate MVP1 |
   | Z01 | Non Charge | Leave / Day-Off |

   (Category accepts `CAPEX`, `OPEX`, `Non Charge` — case/spacing don't
   matter, same as the web tool.)

4. **Open the script editor:** in the master Sheet, go to
   **Extensions ▸ Apps Script**.

5. **Create the two script files:**
   - Delete the default boilerplate in `Code.gs`, or just leave it empty.
   - Click **+ ▸ Script** in the left sidebar, name it `Logic`, paste in
     the full contents of [`Logic.js`](Logic.js).
   - Click **+ ▸ Script** again, name it `Main`, paste in the full
     contents of [`Main.js`](Main.js).
   - Save (Ctrl+S / Cmd+S).

6. **Reload the spreadsheet tab** in your browser (a plain refresh). A
   new **WO Summary** menu appears next to Help.

7. Click **WO Summary ▸ Run Now**. The first time, Google will ask you to
   authorize the script — click through **Advanced ▸ Go to [project
   name] (unsafe)**. This warning is normal for any script you write
   yourself that isn't published to the Marketplace; it's not a signal
   that anything is actually wrong. It needs Sheets access because it
   opens your source files and writes the output tabs.

8. Check the **Table 1**, **Table 2**, and **Combined Raw** tabs — the
   script creates them automatically if they don't exist yet, and
   overwrites them fresh on every run.

## Requirements for the source spreadsheets

- Your Google account needs at least **view access** to every source file
  listed in Config (this is already satisfied if everyone's in the same
  Google Workspace domain with normal internal sharing).
- Each source file's timesheet data must follow the same column layout as
  `krungsri.xlsx`: **Name-Surname, SQ, WO No., WO Name, FTE/OS**, then 31
  daily columns — starting at cell **A3**.

## Files

- **`Logic.js`** — pure classification logic (no Sheets calls). Unit
  tested; this is what actually decides CAPEX vs OPEX vs Non Charge vs
  Unmapped and builds the two output tables.
- **`Main.js`** — Sheets orchestration: reads Config/Mapping, opens each
  source file, writes the output tabs with colors. Can't be unit tested
  outside Apps Script (it's all `SpreadsheetApp` calls), so keep new
  logic in `Logic.js` and keep this file thin.
- **`tests/run-tests.js`** — run with `node tests/run-tests.js` from this
  folder. Covers the same category rules and the same standard sample
  dataset (4 squads, 1 unmapped WO) as the web tool's own test suite, so
  the two stay behaviorally identical.

## Relationship to `index.html`

This is a separate, standalone deliverable — it doesn't replace the
`index.html` web tool. Use whichever fits the moment:

- **`index.html`** — quick, offline, one-off classification from a paste
  or a single `.xlsx` upload. No Google account needed.
- **This Apps Script** — recurring, multi-squad consolidation that runs
  directly inside Google Sheets, with output colored in real cells and no
  copy-paste step.
