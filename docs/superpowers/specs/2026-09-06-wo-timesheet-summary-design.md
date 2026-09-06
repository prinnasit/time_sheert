# WO Timesheet Summary — Design Spec

Date: 2026-09-06
Source file analyzed: `krungsri.xlsx` (Sheet1, A1:AL49)

## Problem

`krungsri.xlsx` is a monthly timesheet template:

- **Rows 1–13**: raw input — one row per person per WO, with daily man-hours (MH)
  across the month in columns F–AJ.
- **Rows 17–34**: a cross-tab summary (Squad × WO) split into CAPEX / OPEX / Non
  Charge column groups, plus a `Summary` row and `Remaining (JUL/AUG)` rows.
- **Rows 37–49**: a per-squad % CAPEX vs % OPEX table.

The live file currently has **no input rows filled in** and **no formulas** —
the output cells are pasted-over zeros / `#DIV/0!` literals. There is a
loose "legend" (rows 38–46, columns G–H) hinting that WO codes like `Z01`,
`Z02`, `Z03` are Non-Charge and a few `Z05`/`Z06`/`W2024-xxx-*` codes are
"special OPEX", but this is not a usable lookup table as-is.

Goal: a single web page that takes pasted/uploaded timesheet input, classifies
each WO as CAPEX / OPEX / Non-Charge / Unmapped using a **user-supplied
mapping table** (not hardcoded), and reproduces the two summary tables —
copyable back into Excel or downloadable as CSV.

## Non-goals

- Writing back into the original `.xlsx` file or preserving its formulas/styles.
- Hosting the WO→category mapping anywhere permanent — it's supplied per session
  (with `localStorage` convenience) rather than maintained as a shared master list.
- Multi-month history / persistence of timesheet data across sessions.

## Solution: single self-contained HTML file

One file, `index.html`, opened directly in a browser (double-click, no server,
no build step). Uses SheetJS (`xlsx` library) from CDN for `.xlsx` upload
parsing; everything else is vanilla JS. All processing happens client-side —
timesheet data (names, hours) never leaves the machine.

### Page layout (top to bottom)

1. **WO Mapping** — a textarea for pasting a table of `WO No. <tab> Category
   <tab> WO Name(optional)`. Persisted to `localStorage` so it's still there
   next time the page is opened. "Clear" button to reset it.
2. **Timesheet Input** — a textarea for pasting the `A2:AL13` range copied
   directly from Excel (tab-separated), **or** an "Upload .xlsx" button that
   reads row 1–13 of the first sheet directly.
3. **Run** button — triggers parsing + classification + rendering of output.
4. **Output** — two tables:
   - Table 1: Squad × WO cross-tab (CAPEX / OPEX / Non Charge / Unmapped
     column groups), with `Summary` row and per-squad `Total` column.
   - Table 2: per-squad CAPEX/OPEX MH and %.
   Each table has its own `Copy` (TSV to clipboard) and `Download CSV` buttons.

### Input parsing

- Timesheet rows are read starting at row 3 of the pasted/uploaded range
  (rows 1–2 are headers), through row 13.
- Columns: `A`=Name, `B`=SQ, `C`=WO No., `D`=WO Name, `E`=FTE/OS,
  `F..AJ`=daily MH (31 columns, day 1–31).
- Row MH total = sum of `F..AJ` computed fresh from the daily cells (not
  read from column AK/AL, in case those are stale).
- A row that fails to parse (wrong column count, non-numeric daily cells)
  is skipped and reported by row number in a warning banner rather than
  aborting the whole run.

### Classification

- WO No. is looked up in the mapping table using a normalized key (trimmed,
  case-insensitive).
- Categories accepted from the mapping table: `CAPEX`, `OPEX`, `NON CHARGE`
  (case-insensitive, spaces/hyphens ignored).
- WO No.s present in the timesheet but absent from the mapping table are
  put in a separate **`⚠ Unmapped`** group — never silently defaulted to
  CAPEX or any other category. A warning banner lists which WO No.s were
  unmapped so the user can fix the mapping table and re-run.

### Table 1 — Squad × WO cross-tab

- Rows: one per distinct Squad found in the input, in first-seen order.
- Columns: one per distinct WO found in the input, grouped and ordered
  `CAPEX → OPEX → Non Charge → Unmapped`; group headers span the columns
  belonging to that group (mirrors the merged-header style of the original
  row 17).
- Cell value: sum of MH for that Squad + WO combination.
- Trailing `Summary` row: column totals.
- Trailing `Total` column per squad: row totals.
- `Remaining (JUL/AUG)` rows from the original template are **out of scope**
  for this tool (no budget figures are supplied as input) — omitted from
  the generated table.

### Table 2 — % CAPEX / OPEX per squad

- Columns: `Squad`, `CAPEX MH`, `OPEX MH`, `CAPEX %`, `OPEX %`.
- `CAPEX % = CAPEX MH / (CAPEX MH + OPEX MH)`, `OPEX % = 1 - CAPEX %`.
- Non-Charge and Unmapped MH are excluded from this denominator by design
  (matches "CAPEX%+OPEX% = 100%" requirement).
- If a squad has zero chargeable MH (CAPEX+OPEX = 0), display `–` instead
  of `#DIV/0!`.

### Number formatting

- Internally all sums are kept as full-precision floats.
- Display: MH values rounded to 2 decimals, % values rounded to 1 decimal.
- Copy-to-clipboard and CSV export use the full-precision values (not the
  rounded display strings) so Excel can keep computing with them.

### Copy / Export

- **Copy**: builds a TSV string (header row + data rows, tab-separated) and
  writes it via `navigator.clipboard.writeText`; button label flips to
  "✓ Copied" for ~1.5s as feedback.
- **Download CSV**: UTF-8 with BOM (avoids mangled non-ASCII/`%` in Excel),
  filename `wo-summary_YYYY-MM-DD.csv` and `wo-percent_YYYY-MM-DD.csv`.

### Validation / error handling (banners, not popups)

- Empty mapping table and/or empty timesheet input at Run time → inline
  message naming exactly what's missing; Run button stays enabled (no
  silent no-op).
- Skipped/unparseable timesheet rows → yellow banner listing row numbers.
- Unmapped WO No.s → yellow banner listing the WO No.s, in addition to the
  `⚠ Unmapped` group appearing in Table 1.

### Testing approach

Before delivery, exercise the page with a small mocked dataset (5–8 rows)
covering all three categories plus one intentionally unmapped WO, to verify
the cross-tab, percentages, copy, and CSV paths all produce correct output.
