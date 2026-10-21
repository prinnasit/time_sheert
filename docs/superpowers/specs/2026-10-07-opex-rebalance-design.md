# OPEX Rebalance — Design Spec

Date: 2026-10-07
Builds on: `2026-09-06-wo-timesheet-summary-design.md`
Decided in: grilling session 2026-10-06/07 (open questions at the bottom)
Status (updated 2026-10-21): implemented and merged. The planner
(eligibility, rounds 1/2, target WO + Remaining, day-level moves) is
unchanged. The confirm/Apply UI and the change log were later replaced by
the editable draft in `2026-10-20-editable-rebalance-design.md`; sections
below that changed carry an **Update** note.

## Problem

Table 2 already flags a squad whose OPEX share (OPEX ÷ (CAPEX + OPEX)) is
above 80% (`OPEX_PCT_ALERT_THRESHOLD`, strict `>` — exactly 80.00% passes).
Flagging isn't enough: the timesheet has to be **corrected** so no squad is
above 80%, and which people get corrected must be justified against a
**role ceiling table** — how many Man-Days per month each role may book to
each category.

Role ceiling table (per person, per month, Man-Day; every row sums to 20):

| Role | Z01-Z03 | CAPEX | OPEX |
|---|---|---|---|
| Automated Tester | 3 | 14 | 3 |
| Cloud Engineer | 1 | 11 | 8 |
| Cloud Engineer Lead | 2 | 10 | 8 |
| Developer | 2 | 16 | 2 |
| DevOps Engineer | 1 | 11 | 8 |
| Engineering Manager | 6 | 10 | 4 |
| Engineering Team Leader | 5 | 11 | 4 |
| Incident Management Engineer | 1 | 0 | 19 |
| Product Owner | 5 | 5 | 10 |
| Project Manager | 5 | 10 | 5 |
| Quality Assurance Lead | 8 | 9.6 | 2.4 |
| Release Manager | 1 | 7 | 12 |
| Software Quality Assurance | 2 | 13 | 5 |
| Solution Architect | 4 | 4 | 12 |
| System Analyst | 4 | 14 | 2 |
| System Analyst Manager | 4 | 8 | 8 |

(Source screenshot may be cut off below "System Analyst Manager" — the table
is user-editable, so missing rows can be added in the UI.)

## Non-goals

- Breaking a role ceiling to force a squad under 80%. If the rules can't
  get there, the tool says so and the user edits the grid by hand.
- Using the Z01-Z03 column for anything but reference (see open question 3).
- Public-holiday calendars — working days are auto-counted Mon–Fri and the
  user corrects the number for holiday months.
- People booked in more than one squad — warned about and excluded.

## New inputs (all persisted in `localStorage`)

1. **Role Ceilings** grid — `Role | Z01-Z03 | CAPEX | OPEX` (MD). Pre-filled
   with the table above; editable like the WO Mapping grid.
2. **People → Role** grid — `Name-Surname | Role`. Names match timesheet
   `Name-Surname` after trim + whitespace collapse + case-insensitive
   compare. **Update:** Role is a text cell with a `<datalist>` of the roles
   in Role Ceilings (not a `<select>`), so free text is possible; an unknown
   role shows up in the skipped list. Pre-filled with a 37-person default
   list (`DEFAULT_PEOPLE_ROLES`) with a "คืนค่าเริ่มต้น" button; "Head of
   Innovation" has no ceiling row on purpose, so that timesheet is never
   edited.
3. **Working days this month** — numeric field. Auto-filled with the
   Mon–Fri count of the month read from the uploaded `.xlsx` (row 2, `F2`
   date); falls back to the current month when the timesheet was pasted.
   User can overwrite it. **Update:** the value is saved
   (`woTimesheetSummary.workingDays`); "ขึ้นเดือนใหม่" resets it to the
   current month.

All three tables also fall back to their defaults when the saved copy is
empty. The WO Mapping grid got a default too (`DEFAULT_WO_MAPPING`, 14 WOs).

Effective ceiling for a person = table value × (working days ÷ 20).

## Rebalance algorithm

Works per squad, only for squads with `opexPct > 0.8`. Moving MH from OPEX
to CAPEX doesn't change the squad's chargeable total `T = C + O`, so the
squad passes once moved MH `x` satisfies `(O − x) / T ≤ 0.8`.

### Eligibility (per person)

A person can be picked only if **all** hold; otherwise they're skipped and
listed in a warning banner with the reason:

- has a Role in People → Role, and the Role exists in Role Ceilings
- appears in exactly one squad in this timesheet (1 person = 1 squad)
- has at least one CAPEX WO row in this timesheet

FTE and OS are both eligible (open question 2).

### Round 1 — people over their OPEX ceiling

1. Candidates: eligible people in the squad with
   `opexMD > opexCeiling`. Sort by excess (`opexMD − opexCeiling`) desc.
2. For each candidate, movable MH = min(
   excess × 8,
   CAPEX headroom = (capexCeiling − capexMD) × 8,
   what the Remaining budgets of their target CAPEX WOs allow).
3. Move 1 MH at a time (see *Day-level move*) until the squad is ≤ 80% —
   then stop (move only what's needed). Then the next candidate.
4. If the squad is still > 80% after all candidates: warning banner
   "squad X ยังเหลือ OPEX xx.xx%" with a **ทำต่อ (Continue)** button.

### Round 2 — only when the user clicks Continue

1. Candidates: eligible people in the squad with CAPEX headroom > 0 who
   still have OPEX MH. Sort by CAPEX headroom desc.
2. Movable MH = min(remaining OPEX MH, CAPEX headroom, Remaining budget).
3. Same 1-MH loop, stop once ≤ 80%.
4. Still > 80% → final warning: cannot be fixed within role ceilings,
   edit manually. No round 3.

### Target CAPEX WO

- Default: the person's CAPEX WO with the most MH this month.
- **Remaining constraint:** a move must not push that WO's
  "Remaining (เดือนนี้)" below 0, counting every move in the current plan.
  If the default WO lacks budget, fall to the person's next CAPEX WO by MH.
  A WO with no "Remaining (เดือนที่แล้ว)" set has no budget limit.
- ~~The suggestion shows a dropdown to change the target WO before Apply.~~
  **Update:** replaced by the editable draft. Each draft row (person, day,
  MH, from WO, to CAPEX WO) can be changed, deleted or added; a target WO
  the person has no row for still creates a new timesheet row. Remaining
  and CAPEX-ceiling overruns in a hand-edited draft are **warnings** (Apply
  stays enabled); invalid rows (MH ≤ 0, MH above what the source cell
  holds, same from/to WO, non-CAPEX target) are **errors** that disable
  Apply.

### Day-level move (open question 1)

Each 1-MH unit:

- **source** = the person's OPEX WO row with the most MH left, on the
  **latest day** that has MH in that row (walk from Day31 backwards)
- **target** = same day, on the target CAPEX WO row
- unit = min(1, source cell value), so fractional cells (e.g. 0.5) are
  handled without going negative

Daily totals per person never change.

## Confirm / Apply / Undo

- After Run, if any squad is > 80%, a **Rebalance** card shows the
  suggestions. Nothing changes until **Apply**. **Update:** the card is now
  an editable day-level draft with buttons "+ เพิ่มการย้าย",
  "↻ คำนวณคำแนะนำใหม่", "ทำต่อ (รอบที่ 2)", and a live "ถ้า Apply ตามนี้"
  preview of each changed squad's CAPEX/OPEX %.
- **Apply** writes the moves into the timesheet grid, then re-runs Table 1
  and Table 2. **Update:** after the first Apply, any later edit in the
  timesheet grid recalculates everything automatically (300 ms debounce),
  without pressing Run; edited Day cells are highlighted with a "เดิม: …"
  tooltip.
- **Update:** after Apply the card also offers "Copy Timesheet ฉบับใหม่"
  (plain TSV, no header, 36 columns, to paste over the sheet's data rows;
  warns when Apply appended new rows) and a "CAPEX / OPEX % ต่อ squad
  (เดิม → ใหม่)" summary with "Copy สรุป CAPEX/OPEX".
- **Original timesheet** = the grid as it was at the first Apply. Round 2
  Apply and later manual grid edits all count as the "new" version; the
  original stays the first one.
- **Undo** restores the original grid and clears the change log.
- The original is discarded on a new `.xlsx` upload or **New Month**.
- Original, new, and change log are persisted in `localStorage`, so a
  reload doesn't lose the audit trail.

## Report output

- **Table 1:** a single table (after-fix values). A changed cell shows
  `before → after` and is highlighted. Copy/Download output contains the
  after-fix numbers only (same shape as today).
- **Table 2:** adds `OPEX % (เดิม)` next to the existing columns
  (after-fix CAPEX % / OPEX %). Red highlight applies to the after-fix
  OPEX %.
- **Change log:** ~~one row per moved cell — name, squad, from WO, to WO,
  day, MH~~ **Update:** one row per changed timesheet cell
  (`diffTimesheets`): Name-Surname, Squad, WO No., Day, เดิม, ใหม่, แก้โดย
  ("Rebalance" or "แก้เอง"), with Copy/Download CSV. A cell edited back to
  its original value drops out of the log.
- **Download timesheet** buttons for both original and new (`.xlsx`, via
  SheetJS which is already loaded).

## Related changes in the same work

- **`.xlsx` upload reads past row 13.** Today it reads the fixed range
  `A3:AJ13` (11 rows) to avoid the summary tables below the data. Change:
  read from row 3 until the first row with neither Name nor WO No. — on
  `krungsri.xlsx` this stops at row 13 exactly, so results don't change,
  but a template with more than 11 people no longer drops rows silently.
  Also read row 2 for the month (working-days auto-fill).
- **Delete `google-apps-script/`.** The feature is `index.html`-only and the
  Apps Script companion is retired. Nothing else references it (only a
  mention in the old QA report). Recoverable from git history.

## Testing

Logic goes in the `app-logic` script block (exported for the Node harness
like the existing builders) so it can be unit tested in `tests/`:

- squad exactly at 80.00% → no suggestions
- round 1 stops as soon as ≤ 80% (doesn't drain every over-ceiling person)
- round 1 never moves a person below their OPEX ceiling or above their
  CAPEX ceiling
- round 2 only runs on request; final warning when still > 80%
- squad of Incident Management Engineers (CAPEX ceiling 0) → nothing
  movable, final warning
- Remaining budget: falls back to next CAPEX WO; WO without Remaining is
  unlimited; never goes negative across multiple people
- skipped people: no role, unknown role, multi-squad, no CAPEX WO
- day-level: per-person daily totals unchanged, latest days first,
  fractional cells
- working days scaling (e.g. 22 days → ×1.1)
- xlsx: stops at first row without Name and WO No.; >11 rows read fully
- Apply → Undo round-trips the grid exactly; state survives reload

**Update:** all of the above are covered — Node unit tests in
`tests/rebalance.js` (`node tests/all.js`) and a Playwright browser suite in
`tests/browser_e2e.py` (`python tests/browser_e2e.py`) that drives the real
page: grids, Run, draft edit/Apply/Continue/Undo, Remaining + New Month,
downloads, `.xlsx` upload and localStorage persistence.

## Open questions (provisional answer in use)

1. **Same-day, 1-MH moves, latest days first** — is this acceptable to
   whoever audits the timesheet? *(Provisional: yes.)*
2. **Yellow/green colouring in the role table** — does it mean anything
   (FTE vs OS, team)? Can OS timesheets be changed at all (billing)?
   *(Provisional: colour ignored, FTE and OS both editable.)*
3. **Z01-Z03** — are these the WOs mapped as "Non Charge", and should
   exceeding the Z ceiling warn? *(Provisional: reference only, unused.)*
