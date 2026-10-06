# OPEX Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a squad's OPEX share is above 80%, suggest (and on confirmation apply) timesheet corrections that move OPEX hours to CAPEX, chosen by per-role monthly ceilings, keeping the original timesheet and a change log for the report.

**Architecture:** All new decision logic is pure functions inside the existing `<script id="app-logic">` block of `index.html` (exported through `module.exports` so the Node harness in `tests/` can unit-test it). The UI additions live in the existing IIFE script and only call those functions. No new files except tests and docs; no new dependencies.

**Tech Stack:** Vanilla JS in a single `index.html`; SheetJS (`xlsx@0.18.5`, already loaded from CDN); Node `assert` test files under `tests/`.

Spec: `docs/superpowers/specs/2026-10-07-opex-rebalance-design.md` (read it first — it is the source of truth for behaviour).

## Global Constraints

- Everything stays in `index.html` (single self-contained file, no build step, no new dependencies). Do **not** touch `krungsri.xlsx`.
- Pure logic goes in `<script id="app-logic">` and is added to its `module.exports`. DOM code goes in the IIFE in the second `<script>`. Top-level `const`/`function` in app-logic are visible to the IIFE (that is how `normalizeWO`, `CATEGORY_LABEL` are already used).
- OPEX alert is strict `>`: a squad at exactly 80.00% passes. The threshold constant is `0.8`.
- Units: timesheet cells are Man-Hours (MH); role ceilings are Man-Days (MD); `MH_PER_DAY = 8` (existing constant). Effective ceiling (MD) = table value × working days ÷ 20.
- Moves are whole hours: each unit is `min(1, source cell value)`, same day, from the OPEX row with the most MH, latest day first. Per-person daily totals never change.
- Never move a person's OPEX below their (scaled) OPEX ceiling in round 1; never push a person's CAPEX above their (scaled) CAPEX ceiling in either round; never push a CAPEX WO's "Remaining (เดือนนี้)" below 0 (WO without a "last month" value = unlimited).
- 1 person = 1 squad; a person in more than one squad is warned about and never edited.
- All `localStorage` access is wrapped in `try/catch` and the page must still work without it.
- User-facing strings are Thai (match the existing UI); code, comments and test names are English.
- Existing tests (`node tests/all.js`) must keep passing after every task.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).

## File Structure

| File | Responsibility |
|---|---|
| `index.html` (app-logic block) | New pure functions: role ceilings & people parsing, working-day math, xlsx row trimming, `planRebalance`, `applyMoves`, `buildChangeLog`, `summarizeRows`, `diffCell`, `timesheetToAoa`; `table2ToRows` gains an optional `beforeTable2` arg |
| `index.html` (markup/CSS) | Two new input cards (Role Ceilings, People → Role), Rebalance card, Change-log card |
| `index.html` (IIFE) | Wiring: new grids + persistence, working-days field, fixed xlsx upload, rebalance render/apply/undo, before→after rendering, downloads |
| `tests/rebalance.js` (new) | Unit tests for every new pure function |
| `tests/all.js` | Add `rebalance.js` to the file list |
| `tests/check-structure.js` | New required element ids + a syntax check of both script blocks |
| `google-apps-script/` | Deleted (Task 1) |

---

### Task 1: Housekeeping — commit the spec, remove `google-apps-script/`

**Files:**
- Add: `docs/superpowers/specs/2026-10-07-opex-rebalance-design.md`, `docs/superpowers/plans/2026-10-07-opex-rebalance.md`
- Delete: `google-apps-script/` (whole folder)

**Interfaces:**
- Consumes: nothing
- Produces: nothing (clean base for later tasks)

- [ ] **Step 1: Confirm nothing outside the folder depends on it**

Run: `grep -rn "google-apps-script" --include=* . --exclude-dir=.git --exclude-dir=google-apps-script`
Expected: only `docs/superpowers/reports/2026-09-14-qa-report.html` (a historical mention — leave it) and this plan/spec.

- [ ] **Step 2: Delete the folder and run the existing suite**

```bash
git rm -r google-apps-script
node tests/all.js
```
Expected: `ALL TEST FILES PASSED`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-07-opex-rebalance-design.md docs/superpowers/plans/2026-10-07-opex-rebalance.md
git commit -m "docs: add OPEX rebalance spec/plan and retire google-apps-script companion" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers — role ceilings, people→role, working days, xlsx rows, export helpers

**Files:**
- Modify: `index.html` app-logic block (insert new code after `table2ToRows`, replace `table2ToRows`, extend `module.exports`)
- Create: `tests/rebalance.js`
- Modify: `tests/all.js` (add `'rebalance.js'` to `files`)

**Interfaces:**
- Consumes: existing `parseNum(v) -> {ok, value}`, `formatMH(n) -> string`, `MH_PER_DAY`
- Produces (all exported on `module.exports`):
  - `OPEX_THRESHOLD` = `0.8`, `BASE_MONTH_MD` = `20`
  - `DEFAULT_ROLE_CEILINGS`: `string[][]` rows `[role, z, capex, opex]`
  - `normalizeKey(s) -> string` (trim, collapse whitespace, lowercase)
  - `parseRoleCeilings(rows) -> { map: { [normalizeKey(role)]: {role, z, capex, opex} }, skipped: number[] }`
  - `parsePeopleRoles(rows) -> { [normalizeKey(name)]: roleString }`
  - `countWorkingDays(year, monthIndex0) -> number` (Mon–Fri)
  - `monthFromSheetValue(v) -> {year, month} | null` (month is 0–11; accepts Excel serial number ≥ 20000, `Date`, or `YYYY-MM…` string)
  - `takeTimesheetRows(rows) -> rows` (stops at first row with blank Name and blank WO No.; each row cut to 36 columns)
  - `TIMESHEET_HEADER`, `timesheetToAoa(rows) -> any[][]`
  - `diffCell(before, after) -> {changed: boolean, text: string}`
  - `table2ToRows(table2, beforeTable2?)` — with 2nd arg adds a 4th column `OPEX % (เดิม)`

- [ ] **Step 1: Create the test file with the helpers tests (failing)**

Create `tests/rebalance.js`:

```js
// tests/rebalance.js — OPEX rebalance: pure helpers + planner + apply.
const assert = require('assert');
const { loadApp } = require('./load-app');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); }
  catch (err) { failures++; console.log('  FAIL - ' + name); console.log('    ' + err.message); }
}

const App = loadApp();

test('DEFAULT_ROLE_CEILINGS: every role sums to 20 MD and parses cleanly', () => {
  assert.strictEqual(App.DEFAULT_ROLE_CEILINGS.length, 16);
  const parsed = App.parseRoleCeilings(App.DEFAULT_ROLE_CEILINGS);
  assert.deepStrictEqual(parsed.skipped, []);
  Object.keys(parsed.map).forEach(k => {
    const c = parsed.map[k];
    assert.ok(Math.abs(c.z + c.capex + c.opex - 20) < 1e-9, c.role + ' does not sum to 20');
  });
  assert.deepStrictEqual(parsed.map['developer'], { role: 'Developer', z: 2, capex: 16, opex: 2 });
});

test('parseRoleCeilings skips rows with a blank role, non-numeric or negative values', () => {
  const parsed = App.parseRoleCeilings([['Dev', '1', '2', '3'], ['', '1', '1', '1'], ['X', 'a', '1', '1'], ['Y', '1', '-1', '1']]);
  assert.deepStrictEqual(Object.keys(parsed.map), ['dev']);
  assert.deepStrictEqual(parsed.skipped, [2, 3, 4]);
});

test('parsePeopleRoles normalizes names and ignores incomplete rows', () => {
  const map = App.parsePeopleRoles([['  Somchai   Jaidee ', ' Developer '], ['Nobody', ''], ['', 'Developer']]);
  assert.deepStrictEqual(map, { 'somchai jaidee': 'Developer' });
});

test('countWorkingDays counts Mon-Fri only', () => {
  assert.strictEqual(App.countWorkingDays(2026, 7), 21); // Aug 2026 starts on a Saturday
  assert.strictEqual(App.countWorkingDays(2026, 1), 20); // Feb 2026 (28 days, 4 full weeks)
});

test('monthFromSheetValue handles Excel serials, Dates, ISO strings and rejects the rest', () => {
  assert.deepStrictEqual(App.monthFromSheetValue(46235), { year: 2026, month: 7 }); // 2026-08-01
  assert.deepStrictEqual(App.monthFromSheetValue(new Date(2026, 7, 15)), { year: 2026, month: 7 });
  assert.deepStrictEqual(App.monthFromSheetValue('2026-08-01'), { year: 2026, month: 7 });
  assert.strictEqual(App.monthFromSheetValue('Day1'), null);
  assert.strictEqual(App.monthFromSheetValue(5), null);
  assert.strictEqual(App.monthFromSheetValue(''), null);
  assert.strictEqual(App.monthFromSheetValue(undefined), null);
});

test('takeTimesheetRows stops at the first row with neither Name nor WO No. and cuts to 36 columns', () => {
  const wide = new Array(40).fill('x');
  const rows = [['A', 'S', '100', 'n', 'ksb'], ['', '', '', '', 'ksb'], ['B', 'S', '200', 'n', 'ksb']];
  const out = App.takeTimesheetRows([wide, rows[0], rows[1], rows[2]]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].length, 36);
  assert.deepStrictEqual(out[1], rows[0]);
});

test('takeTimesheetRows keeps a row that has a name but no WO No. (parseDataRows reports it later)', () => {
  const out = App.takeTimesheetRows([['A', 'S', '', 'n', 'ksb'], ['', '', '', '', '']]);
  assert.strictEqual(out.length, 1);
});

test('timesheetToAoa writes a blank row, one header row, and numeric day cells', () => {
  const row = ['A', 'S', '100', 'n', 'ksb', '8', '', '0.5'].concat(new Array(28).fill(''));
  const aoa = App.timesheetToAoa([row]);
  assert.deepStrictEqual(aoa[0], []);
  assert.strictEqual(aoa[1].length, 36);
  assert.strictEqual(aoa[1][0], 'Name-Surname');
  assert.strictEqual(aoa[1][5], 'Day1');
  assert.strictEqual(aoa[2][5], 8);
  assert.strictEqual(aoa[2][6], '');
  assert.strictEqual(aoa[2][7], 0.5);
  assert.strictEqual(aoa[2][2], '100'); // WO No. stays text
});

test('diffCell shows "before → after" only when the 2-decimal display differs', () => {
  assert.deepStrictEqual(App.diffCell(10, 11.5), { changed: true, text: '10.00 → 11.50' });
  assert.deepStrictEqual(App.diffCell(5, 5), { changed: false, text: '5.00' });
  assert.deepStrictEqual(App.diffCell(1.004, 1.001), { changed: false, text: '1.00' });
});

test('table2ToRows keeps the old shape without a before table and adds OPEX % (เดิม) with one', () => {
  const after = [{ sq: 'S1', capexPct: 0.2, opexPct: 0.8 }, { sq: 'S2', capexPct: null, opexPct: null }];
  const before = [{ sq: 'S1', capexPct: 0.1, opexPct: 0.9 }];
  const plain = App.table2ToRows(after);
  assert.deepStrictEqual(plain.header, ['Squad', 'CAPEX %', 'OPEX %']);
  assert.deepStrictEqual(plain.rows[0], ['S1', 0.2, 0.8]);
  const withBefore = App.table2ToRows(after, before);
  assert.deepStrictEqual(withBefore.header, ['Squad', 'CAPEX %', 'OPEX %', 'OPEX % (เดิม)']);
  assert.deepStrictEqual(withBefore.rows[0], ['S1', 0.2, 0.8, 0.9]);
  assert.deepStrictEqual(withBefore.rows[1], ['S2', '', '', '']);
});

process.on('exit', () => {
  if (failures > 0) { console.log(failures + ' failing test(s)'); process.exitCode = 1; }
  else { console.log('All rebalance tests passed'); }
});
```

- [ ] **Step 2: Register the file and run it to see it fail**

In `tests/all.js` change the list to
`const files = ['check-structure.js', 'run-tests.js', 'edge-cases.js', 'e2e.js', 'rebalance.js'];`

Run: `node tests/rebalance.js`
Expected: FAIL (e.g. `Cannot read properties of undefined (reading 'length')` — the new exports don't exist yet).

- [ ] **Step 3: Implement**

In `index.html`'s app-logic block, **replace** the existing `table2ToRows` function with:

```js
function table2ToRows(table2, beforeTable2) {
  // MH totals aren't shown here — Table 2 is the %-only summary. The
  // underlying MH values still drive the percentage math in buildTable2();
  // they're just not part of this table's output. With a `beforeTable2`
  // (a rebalance has been applied) one extra column carries each squad's
  // original OPEX %.
  const header = ['Squad', 'CAPEX %', 'OPEX %'];
  const beforeBySq = {};
  if (beforeTable2) {
    header.push('OPEX % (เดิม)');
    beforeTable2.forEach(r => { beforeBySq[r.sq] = r.opexPct; });
  }
  const rows = table2.map(r => {
    const row = [r.sq, r.capexPct == null ? '' : r.capexPct, r.opexPct == null ? '' : r.opexPct];
    if (beforeTable2) {
      const b = beforeBySq[r.sq];
      row.push(b == null ? '' : b);
    }
    return row;
  });
  return { header, rows };
}
```

Then insert this block **immediately before** the `if (typeof module !== 'undefined' && module.exports) {` line:

```js
// ---------------------------------------------------------------------
// OPEX rebalance helpers: role ceilings, working days, xlsx/export bits
// ---------------------------------------------------------------------

const OPEX_THRESHOLD = 0.8;
const BASE_MONTH_MD = 20;

// [Role, Z01-Z03, CAPEX, OPEX] — Man-Day ceiling per person per month.
const DEFAULT_ROLE_CEILINGS = [
  ['Automated Tester', '3', '14', '3'],
  ['Cloud Engineer', '1', '11', '8'],
  ['Cloud Engineer Lead', '2', '10', '8'],
  ['Developer', '2', '16', '2'],
  ['DevOps Engineer', '1', '11', '8'],
  ['Engineering Manager', '6', '10', '4'],
  ['Engineering Team Leader', '5', '11', '4'],
  ['Incident Management Engineer', '1', '0', '19'],
  ['Product Owner', '5', '5', '10'],
  ['Project Manager', '5', '10', '5'],
  ['Quality Assurance Lead', '8', '9.6', '2.4'],
  ['Release Manager', '1', '7', '12'],
  ['Software Quality Assurance', '2', '13', '5'],
  ['Solution Architect', '4', '4', '12'],
  ['System Analyst', '4', '14', '2'],
  ['System Analyst Manager', '4', '8', '8']
];

const TIMESHEET_HEADER = ['Name-Surname', 'SQ', 'WO No.', 'WO Name', 'FTE/OS']
  .concat(Array.from({ length: 31 }, (_, i) => 'Day' + (i + 1)));

function normalizeKey(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseRoleCeilings(rowArrays) {
  const map = {};
  const skipped = [];
  rowArrays.forEach((r, i) => {
    const role = String((r && r[0]) == null ? '' : r[0]).trim();
    if (!role) { skipped.push(i + 1); return; }
    const z = parseNum(r[1]), c = parseNum(r[2]), o = parseNum(r[3]);
    if (!z.ok || !c.ok || !o.ok || z.value < 0 || c.value < 0 || o.value < 0) { skipped.push(i + 1); return; }
    map[normalizeKey(role)] = { role: role, z: z.value, capex: c.value, opex: o.value };
  });
  return { map: map, skipped: skipped };
}

function parsePeopleRoles(rowArrays) {
  const map = {};
  rowArrays.forEach(r => {
    const name = normalizeKey(r && r[0]);
    const role = String((r && r[1]) == null ? '' : r[1]).trim();
    if (name && role) map[name] = role;
  });
  return map;
}

function countWorkingDays(year, monthIndex) {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, monthIndex, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

// Which month a sheet header cell (the template's F2 = Day1 date) refers to.
// Excel stores dates as serial numbers; converting the serial by hand
// (instead of asking SheetJS for Date objects) avoids timezone drift.
function monthFromSheetValue(v) {
  if (v instanceof Date) {
    return isNaN(v) ? null : { year: v.getFullYear(), month: v.getMonth() };
  }
  if (typeof v === 'number') {
    if (!(v >= 20000 && v < 80000)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  }
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(v.trim());
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) - 1 };
  }
  return null;
}

// Rows read from the uploaded sheet starting at row 3: keep going until the
// first row with neither a Name nor a WO No. (the template leaves a gap
// before its summary tables), and keep only columns A..AJ (36 columns).
function takeTimesheetRows(rows) {
  const out = [];
  for (const r of rows) {
    const name = String((r && r[0]) == null ? '' : r[0]).trim();
    const wo = String((r && r[2]) == null ? '' : r[2]).trim();
    if (!name && !wo) break;
    out.push(r.slice(0, 36));
  }
  return out;
}

// Rows for a downloadable .xlsx that can be re-uploaded: row 1 blank, row 2
// the header (so data starts at row 3 like the template), day cells numeric.
function timesheetToAoa(rows) {
  const body = rows.map(r => r.map((c, i) => {
    if (c == null) return '';
    if (i < 5) return c;
    if (String(c).trim() === '') return '';
    const p = parseNum(c);
    return p.ok ? p.value : c;
  }));
  return [[], TIMESHEET_HEADER].concat(body);
}

function diffCell(before, after) {
  const b = formatMH(before), a = formatMH(after);
  return b === a ? { changed: false, text: a } : { changed: true, text: b + ' → ' + a };
}
```

Finally extend the `module.exports` object with:
`OPEX_THRESHOLD, BASE_MONTH_MD, DEFAULT_ROLE_CEILINGS, TIMESHEET_HEADER, normalizeKey, parseRoleCeilings, parsePeopleRoles, countWorkingDays, monthFromSheetValue, takeTimesheetRows, timesheetToAoa, diffCell`.

- [ ] **Step 4: Run all tests**

Run: `node tests/all.js`
Expected: `ALL TEST FILES PASSED` (rebalance.js prints 10 `ok -` lines).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/rebalance.js tests/all.js
git commit -m "feat: add role-ceiling, working-day and xlsx-row helpers for OPEX rebalance" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The planner — `planRebalance`

**Files:**
- Modify: `index.html` app-logic block (insert after the Task 2 block, extend `module.exports`)
- Modify: `tests/rebalance.js` (append tests before the `process.on('exit'…)` block)

**Interfaces:**
- Consumes (Task 2): `normalizeKey`, `OPEX_THRESHOLD`, `BASE_MONTH_MD`; existing `parseNum`, `normalizeWO`, `MH_PER_DAY`, `parseMappingText` result shape `{ map: { KEY: {wo, category, name} } }` (categories `'CAPEX' | 'OPEX' | 'NON_CHARGE'`)
- Produces: `extractEntries(rowArrays, mapping)` and `planRebalance(ctx, opts)` (both exported).

`ctx` = `{ rowArrays: string[][] (grid rows, 36 cols), mapping: parseMappingText(...) result, roleMap: parsePeopleRoles(...) result, ceilings: parseRoleCeilings(...).map, workingDays: number, remainingLast: { [WOKEY]: number } (MD; absent = unlimited), threshold?: number }`
`opts` = `{ includeRound2?: boolean, targetOverrides?: { [nameKey]: woKey } }`

Returns:
```
{
  squads: [{ sq, beforePct, afterPct, status }],   // status: 'ok' | 'fixed' | 'needs-continue' | 'unresolvable'
  moves:  [{ nameKey, name, sq, fte, round, fromRow, fromWoNo, fromWoKey,
             toRow (null = new row), toWoNo, toWoKey, toWoName, day (1-31), mh }],
  lines:  [{ nameKey, name, sq, role, round, movedMH, opexMDBefore, opexCeilingMD,
             fromWoNos[], toWoKey, toWoNos[], targetOptions: [{woKey, woNo, woName}], error: string|null }],
  skipped:[{ name, sq, reason }],
  capexOptions: [{ woKey, woNo, woName }]
}
```

- [ ] **Step 1: Append failing tests**

Insert before `process.on('exit'` in `tests/rebalance.js`:

```js
// ---- planRebalance ------------------------------------------------------
function row(name, sq, wo, dayValues) {
  const d = new Array(31).fill('');
  Object.keys(dayValues || {}).forEach(k => { d[Number(k) - 1] = String(dayValues[k]); });
  return [name, sq, wo, wo, 'FTE'].concat(d);
}
function days(from, to, v, extra) {
  const o = {};
  for (let d = from; d <= to; d++) o[d] = v;
  return Object.assign(o, extra || {});
}
const mapping = App.parseMappingText(['C1\tCAPEX\tCap 1', 'C2\tCAPEX\tCap 2', 'C3\tCAPEX\tCap 3', 'O1\tOPEX\tOps 1', 'Z01\tNon Charge\tLeave'].join('\n'));
const ceilings = App.parseRoleCeilings(App.DEFAULT_ROLE_CEILINGS).map;
function ctxFor(rows, people, extra) {
  return Object.assign({ rowArrays: rows, mapping, roleMap: App.parsePeopleRoles(people), ceilings, workingDays: 20, remainingLast: {} }, extra || {});
}
const DEV = n => [n, 'Developer'];

test('a squad at exactly 80.00% OPEX gets no suggestions', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8, 2: 8 }), row('Dev1', 'S1', 'O1', days(3, 10, 8))]; // C=16 O=64
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1')]));
  assert.strictEqual(plan.moves.length, 0);
  assert.strictEqual(plan.squads[0].status, 'ok');
});

test('round 1 moves only as many whole hours as needed, latest day first, into the person\'s CAPEX WO', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8, 2: 8 }), row('Dev1', 'S1', 'O1', days(3, 11, 8))]; // C=16 O=72 -> 81.8%
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1')]));
  assert.strictEqual(plan.moves.length, 2);
  plan.moves.forEach(m => {
    assert.strictEqual(m.day, 11);
    assert.strictEqual(m.mh, 1);
    assert.strictEqual(m.fromWoNo, 'O1');
    assert.strictEqual(m.toWoNo, 'C1');
    assert.strictEqual(m.fromRow, 1);
    assert.strictEqual(m.toRow, 0);
    assert.strictEqual(m.round, 1);
  });
  assert.strictEqual(plan.squads[0].status, 'fixed');
  assert.ok(Math.abs(plan.squads[0].beforePct - 72 / 88) < 1e-12);
  assert.ok(Math.abs(plan.squads[0].afterPct - 70 / 88) < 1e-12);
});

test('round 1 starts with whoever is furthest over their OPEX ceiling and stops once the squad passes', () => {
  const rows = [
    row('Dev2', 'S1', 'O1', days(1, 10, 8)), row('Dev2', 'S1', 'C1', { 11: 8 }),   // excess 64 MH
    row('Dev1', 'S1', 'O1', days(1, 4, 8)), row('Dev1', 'S1', 'C1', { 11: 8, 12: 8 }) // excess 16 MH
  ]; // C=24 O=112 T=136 -> needs 4 MH
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1'), DEV('Dev2')]));
  assert.strictEqual(plan.moves.length, 4);
  plan.moves.forEach(m => { assert.strictEqual(m.name, 'Dev2'); assert.strictEqual(m.day, 10); });
  assert.strictEqual(plan.lines.length, 1);
  assert.strictEqual(plan.lines[0].movedMH, 4);
  assert.strictEqual(plan.lines[0].role, 'Developer');
  assert.strictEqual(plan.lines[0].opexMDBefore, 10);
  assert.strictEqual(plan.lines[0].opexCeilingMD, 2);
});

const dev4Rows = () => [row('Dev4', 'S1', 'C1', { 1: 1 }), row('Dev4', 'S1', 'O1', { 2: 8, 3: 8, 4: 2 })]; // C=1 O=18

test('round 1 never takes OPEX below the role ceiling; the squad is flagged needs-continue', () => {
  const plan = App.planRebalance(ctxFor(dev4Rows(), [DEV('Dev4')]));
  assert.strictEqual(plan.moves.length, 2); // excess is only 2 MH (18 - 16)
  assert.strictEqual(plan.squads[0].status, 'needs-continue');
  assert.ok(plan.squads[0].afterPct > 0.8);
});

test('round 2 runs only when asked and uses remaining CAPEX headroom', () => {
  const plan = App.planRebalance(ctxFor(dev4Rows(), [DEV('Dev4')]), { includeRound2: true });
  assert.deepStrictEqual(plan.moves.map(m => m.round), [1, 1, 2]);
  assert.deepStrictEqual(plan.moves.map(m => m.day), [4, 4, 3]);
  assert.strictEqual(plan.squads[0].status, 'fixed');
});

test('scaling the ceilings by working days (40 days = x2) removes the round-1 excess', () => {
  const plan = App.planRebalance(ctxFor(dev4Rows(), [DEV('Dev4')], { workingDays: 40 }));
  assert.strictEqual(plan.moves.length, 0);
  assert.strictEqual(plan.squads[0].status, 'needs-continue');
  const plan2 = App.planRebalance(ctxFor(dev4Rows(), [DEV('Dev4')], { workingDays: 40 }), { includeRound2: true });
  assert.strictEqual(plan2.moves.length, 3);
  plan2.moves.forEach(m => assert.strictEqual(m.round, 2));
});

test('a role with CAPEX ceiling 0 cannot be moved: unresolvable after round 2', () => {
  const rows = [row('Inc1', 'S2', 'O1', { 1: 8 }), row('Inc1', 'S2', 'C1', {})];
  const people = [['Inc1', 'Incident Management Engineer']];
  const r1 = App.planRebalance(ctxFor(rows, people));
  assert.strictEqual(r1.moves.length, 0);
  assert.strictEqual(r1.squads[0].status, 'needs-continue');
  const r2 = App.planRebalance(ctxFor(rows, people), { includeRound2: true });
  assert.strictEqual(r2.moves.length, 0);
  assert.strictEqual(r2.squads[0].status, 'unresolvable');
});

test('people who cannot be edited are skipped with a reason', () => {
  const rows = [
    row('Ghost', 'S3', 'O1', { 1: 8 }), row('NoCap', 'S3', 'O1', { 1: 8 }),
    row('Multi', 'S3', 'O1', { 1: 8 }), row('Multi', 'S4', 'C1', { 1: 8 }),
    row('Weird', 'S3', 'O1', { 1: 8 })
  ];
  const people = [DEV('NoCap'), DEV('Multi'), ['Weird', 'Unicorn']];
  const plan = App.planRebalance(ctxFor(rows, people));
  const reasons = {};
  plan.skipped.forEach(s => { reasons[s.name] = s.reason; });
  assert.strictEqual(reasons.Ghost, 'ยังไม่ได้ระบุตำแหน่ง');
  assert.strictEqual(reasons.NoCap, 'ไม่มี CAPEX WO');
  assert.strictEqual(reasons.Multi, 'อยู่หลาย squad');
  assert.strictEqual(reasons.Weird, 'ไม่พบตำแหน่ง "Unicorn" ในตารางเพดาน');
  assert.strictEqual(plan.moves.length, 0);
});

function dev5Rows() {
  return [
    row('Dev5', 'S1', 'C1', { 1: 8, 2: 8 }),                    // 16 MH
    row('Dev5', 'S1', 'C2', { 12: 1 }),                          // 1 MH
    row('Dev5', 'S1', 'O1', days(3, 11, 8, { 13: 8, 14: 8 }))    // 88 MH -> needs 4 MH
  ];
}

test('Remaining budget: never drives a WO below 0, falls back to the next CAPEX WO', () => {
  // C1 already uses 2 MD; 2.125 MD of budget leaves room for exactly 1 MH (0.125 MD).
  const plan = App.planRebalance(ctxFor(dev5Rows(), [DEV('Dev5')], { remainingLast: { C1: 2.125 } }));
  assert.deepStrictEqual(plan.moves.map(m => m.toWoNo), ['C1', 'C2', 'C2', 'C2']);
});

test('a WO with no Remaining value is unlimited', () => {
  const plan = App.planRebalance(ctxFor(dev5Rows(), [DEV('Dev5')]));
  assert.deepStrictEqual(plan.moves.map(m => m.toWoNo), ['C1', 'C1', 'C1', 'C1']);
});

test('when no CAPEX WO has budget the person is reported with an error and nothing moves', () => {
  const plan = App.planRebalance(ctxFor(dev5Rows(), [DEV('Dev5')], { remainingLast: { C1: 2, C2: 0.125 } }));
  assert.strictEqual(plan.moves.length, 0);
  assert.strictEqual(plan.lines.length, 1);
  assert.ok(plan.lines[0].error);
});

test('targetOverrides redirect a person to another CAPEX WO, creating a new row when needed', () => {
  const plan = App.planRebalance(ctxFor(dev5Rows(), [DEV('Dev5')]), { targetOverrides: { dev5: 'C3' } });
  assert.strictEqual(plan.moves.length, 4);
  plan.moves.forEach(m => { assert.strictEqual(m.toWoKey, 'C3'); assert.strictEqual(m.toRow, null); assert.strictEqual(m.toWoNo, 'C3'); });
  assert.strictEqual(plan.lines[0].toWoKey, 'C3');
  assert.deepStrictEqual(plan.lines[0].targetOptions.map(o => o.woKey).slice(0, 2), ['C1', 'C2']); // own WOs first
  assert.ok(plan.lines[0].targetOptions.some(o => o.woKey === 'C3'));
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node tests/rebalance.js`
Expected: the new tests FAIL with `App.planRebalance is not a function`.

- [ ] **Step 3: Implement**

Insert **after** the Task 2 block (still before the `module.exports` guard):

```js
// ---------------------------------------------------------------------
// OPEX rebalance planner
// ---------------------------------------------------------------------

const PLAN_EPS = 1e-9;

// Parses grid rows into per-row entries that keep the 31 daily values.
// Same validity rules as parseDataRows (<5 cells, blank WO No. or a
// non-numeric day cell => row ignored). `index` is the position in
// `rowArrays`, which applyMoves() uses to write moves back.
function extractEntries(rowArrays, mapping) {
  const entries = [];
  rowArrays.forEach((r, index) => {
    if (!r || r.length < 5) return;
    const woNo = String(r[2] == null ? '' : r[2]).trim();
    if (!woNo) return;
    const days = [];
    for (let i = 0; i < 31; i++) {
      const p = parseNum(r[5 + i]);
      if (!p.ok) return;
      days.push(p.value);
    }
    const name = String(r[0] == null ? '' : r[0]).trim();
    const woKey = normalizeWO(woNo);
    const m = mapping.map[woKey];
    entries.push({
      index: index,
      name: name,
      nameKey: normalizeKey(name),
      sq: String(r[1] == null ? '' : r[1]).trim() || '(Unspecified)',
      woNo: woNo,
      woKey: woKey,
      woName: String(r[3] == null ? '' : r[3]).trim(),
      fte: String(r[4] == null ? '' : r[4]),
      category: m ? m.category : 'UNMAPPED',
      days: days
    });
  });
  return entries;
}

function planRebalance(ctx, opts) {
  opts = opts || {};
  const threshold = ctx.threshold == null ? OPEX_THRESHOLD : ctx.threshold;
  const scale = ctx.workingDays / BASE_MONTH_MD;
  const overrides = opts.targetOverrides || {};
  const remainingLast = ctx.remainingLast || {};
  const entries = extractEntries(ctx.rowArrays, ctx.mapping);

  const sumDays = e => e.days.reduce((a, b) => a + b, 0);
  const uniq = a => a.filter((v, i) => a.indexOf(v) === i);

  const capexOptions = Object.keys(ctx.mapping.map)
    .filter(k => ctx.mapping.map[k].category === 'CAPEX')
    .map(k => ({ woKey: k, woNo: ctx.mapping.map[k].wo, woName: ctx.mapping.map[k].name || ctx.mapping.map[k].wo }));

  // -- aggregate current state ------------------------------------------
  const squads = {};
  const squadOrder = [];
  const woUsedMD = {};
  const persons = {};
  const personSquads = {};
  entries.forEach(e => {
    if (!squads[e.sq]) { squads[e.sq] = { capex: 0, opex: 0 }; squadOrder.push(e.sq); }
    const mh = sumDays(e);
    woUsedMD[e.woKey] = (woUsedMD[e.woKey] || 0) + mh / MH_PER_DAY;
    if (e.category === 'CAPEX') squads[e.sq].capex += mh;
    else if (e.category === 'OPEX') squads[e.sq].opex += mh;
    const p = persons[e.nameKey] || (persons[e.nameKey] = { nameKey: e.nameKey, name: e.name, sq: e.sq, entries: [] });
    p.entries.push(e);
    (personSquads[e.nameKey] = personSquads[e.nameKey] || {})[e.sq] = true;
  });

  const personMH = (p, cat) => p.entries.reduce((a, e) => a + (e.category === cat ? sumDays(e) : 0), 0);
  const squadPct = sq => { const t = squads[sq]; const ch = t.capex + t.opex; return ch > 0 ? t.opex / ch : null; };
  const isOver = sq => { const p = squadPct(sq); return p != null && p > threshold; };

  Object.keys(persons).forEach(k => { persons[k].startOpexMH = personMH(persons[k], 'OPEX'); });
  const beforePct = {};
  squadOrder.forEach(sq => { beforePct[sq] = squadPct(sq); });

  function ineligibleReason(p) {
    if (!p.nameKey) return 'ไม่มีชื่อ';
    if (Object.keys(personSquads[p.nameKey]).length > 1) return 'อยู่หลาย squad';
    const roleName = ctx.roleMap[p.nameKey];
    if (!roleName) return 'ยังไม่ได้ระบุตำแหน่ง';
    if (!ctx.ceilings[normalizeKey(roleName)]) return 'ไม่พบตำแหน่ง "' + roleName + '" ในตารางเพดาน';
    if (!p.entries.some(e => e.category === 'CAPEX')) return 'ไม่มี CAPEX WO';
    return null;
  }
  function ceilOf(p) {
    const c = ctx.ceilings[normalizeKey(ctx.roleMap[p.nameKey])];
    return { opexMH: c.opex * scale * MH_PER_DAY, capexMH: c.capex * scale * MH_PER_DAY };
  }
  function infoOf(p) {
    const c = ceilOf(p);
    const o = personMH(p, 'OPEX'), cx = personMH(p, 'CAPEX');
    return { o: o, excess: o - c.opexMH, headroom: c.capexMH - cx };
  }

  // The person's own CAPEX WOs, biggest first — or just the user's override.
  function targetsFor(p) {
    const ov = overrides[p.nameKey];
    if (ov) { const m = capexOptions.find(o => o.woKey === ov); return m ? [m] : []; }
    const own = {};
    p.entries.forEach(e => {
      if (e.category !== 'CAPEX') return;
      const o = own[e.woKey] || (own[e.woKey] = { woKey: e.woKey, woNo: e.woNo, woName: e.woName || e.woNo, mh: 0 });
      o.mh += sumDays(e);
    });
    return Object.keys(own).map(k => own[k]).sort((a, b) => (b.mh - a.mh) || (a.woKey < b.woKey ? -1 : 1));
  }
  function optionsFor(p) {
    const own = uniq(p.entries.filter(e => e.category === 'CAPEX').map(e => e.woKey));
    const first = own.map(k => capexOptions.find(o => o.woKey === k)).filter(Boolean);
    return first.concat(capexOptions.filter(o => own.indexOf(o.woKey) < 0));
  }

  // -- the moves --------------------------------------------------------
  const moves = [];
  const blocked = {};
  const BLOCKED_TEXT = 'งบ Remaining ของ WO ปลายทางไม่พอ';

  // Moves one unit (<= 1 MH) of OPEX to CAPEX for person p. Returns the MH
  // moved, or 0 when nothing can be moved (no OPEX left, the unit would
  // exceed `limitMH`, or no target WO has Remaining budget).
  function tryMoveUnit(p, limitMH, targets, round) {
    let src = null, srcTotal = 0;
    p.entries.forEach(e => {
      if (e.category !== 'OPEX') return;
      const t = sumDays(e);
      if (t > srcTotal + PLAN_EPS) { src = e; srcTotal = t; }
    });
    if (!src) return 0;
    let day = -1;
    for (let d = 30; d >= 0; d--) { if (src.days[d] > PLAN_EPS) { day = d; break; } }
    if (day < 0) return 0;
    const unit = Math.min(1, src.days[day]);
    if (unit > limitMH + PLAN_EPS) return 0;

    const target = targets.find(t => {
      const last = remainingLast[t.woKey];
      return last === undefined || last - (woUsedMD[t.woKey] || 0) - unit / MH_PER_DAY >= -PLAN_EPS;
    });
    if (!target) { blocked[p.nameKey] = BLOCKED_TEXT; return 0; }

    let tgt = p.entries.find(e => e.category === 'CAPEX' && e.woKey === target.woKey);
    if (!tgt) {
      tgt = {
        index: null, name: p.name, nameKey: p.nameKey, sq: p.sq, woNo: target.woNo, woKey: target.woKey,
        woName: target.woName, fte: src.fte, category: 'CAPEX', days: new Array(31).fill(0)
      };
      p.entries.push(tgt);
    }
    src.days[day] -= unit;
    tgt.days[day] += unit;
    squads[p.sq].opex -= unit;
    squads[p.sq].capex += unit;
    woUsedMD[target.woKey] = (woUsedMD[target.woKey] || 0) + unit / MH_PER_DAY;
    moves.push({
      nameKey: p.nameKey, name: p.name, sq: p.sq, fte: src.fte, round: round,
      fromRow: src.index, fromWoNo: src.woNo, fromWoKey: src.woKey,
      toRow: tgt.index, toWoNo: tgt.woNo, toWoKey: tgt.woKey, toWoName: tgt.woName,
      day: day + 1, mh: unit
    });
    return unit;
  }

  function runRound(sq, round) {
    let cands = Object.keys(persons).map(k => persons[k]).filter(p => p.sq === sq && !ineligibleReason(p));
    if (round === 1) {
      cands = cands.filter(p => infoOf(p).excess > PLAN_EPS).sort((a, b) => infoOf(b).excess - infoOf(a).excess);
    } else {
      cands = cands.filter(p => infoOf(p).headroom > PLAN_EPS && infoOf(p).o > PLAN_EPS)
        .sort((a, b) => infoOf(b).headroom - infoOf(a).headroom);
    }
    for (const p of cands) {
      const targets = targetsFor(p);
      while (isOver(sq)) {
        const i = infoOf(p);
        const limit = round === 1 ? Math.min(i.excess, i.headroom) : Math.min(i.o, i.headroom);
        if (limit <= PLAN_EPS) break;
        if (!tryMoveUnit(p, limit, targets, round)) break;
      }
      if (!isOver(sq)) return;
    }
  }

  const overSquads = squadOrder.filter(sq => isOver(sq));

  const skipped = [];
  overSquads.forEach(sq => {
    Object.keys(persons).map(k => persons[k]).forEach(p => {
      if (p.sq !== sq || p.startOpexMH <= PLAN_EPS) return;
      const reason = ineligibleReason(p);
      if (reason) skipped.push({ name: p.name, sq: sq, reason: reason });
    });
  });

  overSquads.forEach(sq => {
    runRound(sq, 1);
    if (opts.includeRound2 && isOver(sq)) runRound(sq, 2);
  });

  // -- result -----------------------------------------------------------
  const squadResults = squadOrder.map(sq => {
    let status = 'ok';
    if (beforePct[sq] != null && beforePct[sq] > threshold) {
      status = !isOver(sq) ? 'fixed' : (opts.includeRound2 ? 'unresolvable' : 'needs-continue');
    }
    return { sq: sq, beforePct: beforePct[sq], afterPct: squadPct(sq), status: status };
  });

  const lineKeys = [];
  moves.forEach(m => { if (lineKeys.indexOf(m.nameKey) < 0) lineKeys.push(m.nameKey); });
  Object.keys(blocked).forEach(k => { if (lineKeys.indexOf(k) < 0) lineKeys.push(k); });
  const lines = lineKeys.map(k => {
    const p = persons[k];
    const mine = moves.filter(m => m.nameKey === k);
    const firstTarget = targetsFor(p)[0];
    return {
      nameKey: k, name: p.name, sq: p.sq, role: ctx.roleMap[k],
      round: mine.length ? Math.max.apply(null, mine.map(m => m.round)) : 1,
      movedMH: mine.reduce((a, m) => a + m.mh, 0),
      opexMDBefore: p.startOpexMH / MH_PER_DAY,
      opexCeilingMD: ceilOf(p).opexMH / MH_PER_DAY,
      fromWoNos: uniq(mine.map(m => m.fromWoNo)),
      toWoKey: overrides[k] || (mine.length ? mine[0].toWoKey : (firstTarget ? firstTarget.woKey : '')),
      toWoNos: uniq(mine.map(m => m.toWoNo)),
      targetOptions: optionsFor(p),
      error: blocked[k] || null
    };
  });

  return { squads: squadResults, moves: moves, lines: lines, skipped: skipped, capexOptions: capexOptions };
}
```

Add `extractEntries, planRebalance` to `module.exports`.

- [ ] **Step 4: Run all tests**

Run: `node tests/all.js`
Expected: `ALL TEST FILES PASSED`. If a planner test fails, fix the planner (not the expectation) unless the expectation contradicts the spec.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/rebalance.js
git commit -m "feat: add planRebalance (role-ceiling rounds, day-level moves, Remaining budget)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Apply moves, change log, summary pipeline

**Files:**
- Modify: `index.html` app-logic block (insert after planner, extend `module.exports`)
- Modify: `tests/rebalance.js`

**Interfaces:**
- Consumes (Task 3): the `moves` array shape from `planRebalance`; existing `parseDataRows`, `classifyRows`, `buildTable1`, `buildTable2`, `parseNum`
- Produces (exported):
  - `applyMoves(rowArrays, moves) -> rowArrays'` — returns **new** arrays, never mutates the input; subtracts `m.mh` from the source cell, adds to the target cell (same day), appends a new row (`[name, sq, toWoNo, toWoName, fte, 31 blanks]`) for moves with `toRow === null` (one row per `nameKey|toWoKey`); a cell that becomes 0 is written as `''`; numbers rounded to 6 decimals
  - `buildChangeLog(moves) -> { header: ['Name-Surname','Squad','From WO','To WO','Day','MH'], rows }` — moves summed per (person, from, to, day)
  - `summarizeRows(rowArrays, mapping) -> { parsed, classified, table1, table2 }`

- [ ] **Step 1: Append failing tests** (before the `process.on('exit'` block)

```js
// ---- applyMoves / buildChangeLog / summarizeRows --------------------------
function dayTotals(rows) {
  const t = {};
  rows.forEach(r => {
    for (let d = 0; d < 31; d++) {
      const v = Number(r[5 + d]) || 0;
      t[r[0] + '#' + d] = (t[r[0] + '#' + d] || 0) + v;
    }
  });
  return t;
}

test('applyMoves writes the moves, keeps each person\'s daily totals, and does not mutate its input', () => {
  const rows = [
    row('Dev2', 'S1', 'O1', days(1, 10, 8)), row('Dev2', 'S1', 'C1', { 11: 8 }),
    row('Dev1', 'S1', 'O1', days(1, 4, 8)), row('Dev1', 'S1', 'C1', { 11: 8, 12: 8 })
  ];
  const snapshot = JSON.stringify(rows);
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1'), DEV('Dev2')]));
  const after = App.applyMoves(rows, plan.moves);
  assert.strictEqual(JSON.stringify(rows), snapshot);
  assert.deepStrictEqual(dayTotals(after), dayTotals(rows));
  assert.strictEqual(after[0][5 + 9], '4');   // Dev2 O1 day 10: 8 -> 4
  assert.strictEqual(after[1][5 + 9], '4');   // Dev2 C1 day 10: '' -> 4
  const t2 = App.summarizeRows(after, mapping).table2;
  assert.ok(t2[0].opexPct <= 0.8);
});

test('applyMoves appends one new row for a WO the person had no row for', () => {
  const rows = dev5Rows();
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev5')]), { targetOverrides: { dev5: 'C3' } });
  const after = App.applyMoves(rows, plan.moves);
  assert.strictEqual(after.length, rows.length + 1);
  const added = after[after.length - 1];
  assert.deepStrictEqual(added.slice(0, 5), ['Dev5', 'S1', 'C3', 'Cap 3', 'FTE']);
  assert.strictEqual(added[5 + 13], '4');
  assert.deepStrictEqual(dayTotals(after), dayTotals(rows));
});

test('applyMoves writes an emptied source cell as a blank string', () => {
  const rows = [row('Dev1', 'S1', 'O1', { 5: 1 }), row('Dev1', 'S1', 'C1', {})];
  const moves = [{ nameKey: 'dev1', name: 'Dev1', sq: 'S1', fte: 'FTE', fromRow: 0, toRow: 1, toWoKey: 'C1', toWoNo: 'C1', toWoName: 'C1', day: 5, mh: 1 }];
  const after = App.applyMoves(rows, moves);
  assert.strictEqual(after[0][5 + 4], '');
  assert.strictEqual(after[1][5 + 4], '1');
});

test('buildChangeLog sums per-hour moves into one line per person/WO pair/day', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8, 2: 8 }), row('Dev1', 'S1', 'O1', days(3, 11, 8))];
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1')]));
  const log = App.buildChangeLog(plan.moves);
  assert.deepStrictEqual(log.header, ['Name-Surname', 'Squad', 'From WO', 'To WO', 'Day', 'MH']);
  assert.deepStrictEqual(log.rows, [['Dev1', 'S1', 'O1', 'C1', 11, 2]]);
});

test('summarizeRows runs parse → classify → Table 1/2 on grid rows', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8 }), row('Dev1', 'S1', 'O1', { 2: 8 })];
  const s = App.summarizeRows(rows, mapping);
  assert.strictEqual(s.parsed.rows.length, 2);
  assert.strictEqual(s.table2[0].opexPct, 0.5);
  assert.strictEqual(s.table1.grandTotal, 2);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node tests/rebalance.js` → the five new tests FAIL (`App.applyMoves is not a function`, …).

- [ ] **Step 3: Implement** — insert after `planRebalance`:

```js
// Applies planRebalance() moves to timesheet grid rows and returns NEW rows.
function applyMoves(rowArrays, moves) {
  const rows = rowArrays.map(r => r.slice());
  const created = {};
  const fmt = v => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? '' : String(r); };
  const num = c => { const p = parseNum(c); return p.ok ? p.value : 0; };
  moves.forEach(m => {
    const col = 5 + m.day - 1;
    const src = rows[m.fromRow];
    src[col] = fmt(num(src[col]) - m.mh);
    let tgt;
    if (m.toRow != null) {
      tgt = rows[m.toRow];
    } else {
      const key = m.nameKey + '|' + m.toWoKey;
      tgt = created[key];
      if (!tgt) {
        tgt = [m.name, m.sq, m.toWoNo, m.toWoName, m.fte].concat(new Array(31).fill(''));
        created[key] = tgt;
        rows.push(tgt);
      }
    }
    tgt[col] = fmt(num(tgt[col]) + m.mh);
  });
  return rows;
}

function buildChangeLog(moves) {
  const order = [];
  const byKey = {};
  moves.forEach(m => {
    const key = [m.nameKey, m.sq, m.fromWoNo, m.toWoNo, m.day].join('|');
    if (!byKey[key]) {
      byKey[key] = [m.name, m.sq, m.fromWoNo, m.toWoNo, m.day, 0];
      order.push(key);
    }
    byKey[key][5] += m.mh;
  });
  return {
    header: ['Name-Surname', 'Squad', 'From WO', 'To WO', 'Day', 'MH'],
    rows: order.map(k => byKey[k])
  };
}

function summarizeRows(rowArrays, mapping) {
  const parsed = parseDataRows(rowArrays);
  const classified = classifyRows(parsed.rows, mapping);
  return { parsed: parsed, classified: classified, table1: buildTable1(classified.rows), table2: buildTable2(classified.rows) };
}
```

Add `applyMoves, buildChangeLog, summarizeRows` to `module.exports`.

- [ ] **Step 4: Run all tests**

Run: `node tests/all.js` → `ALL TEST FILES PASSED`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/rebalance.js
git commit -m "feat: add applyMoves, buildChangeLog and summarizeRows" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: UI inputs — Role Ceilings, People → Role, working days, xlsx upload fix

**Files:**
- Modify: `index.html` (markup, CSS, IIFE)
- Modify: `tests/check-structure.js`

**Interfaces:**
- Consumes (Task 2): `DEFAULT_ROLE_CEILINGS`, `parseRoleCeilings`, `parsePeopleRoles`, `countWorkingDays`, `monthFromSheetValue`, `takeTimesheetRows`
- Produces (IIFE-scope, used by Task 6): `roleCeilingsGrid`, `peopleRolesGrid` (grid editors with `getRows()/setRows()`), `workingDaysValue() -> number|null`, `workingDaysInput`; element ids: `role-ceilings-grid`, `role-ceilings-add-row-btn`, `role-ceilings-reset-btn`, `working-days-input`, `working-days-hint`, `people-roles-grid`, `people-roles-add-row-btn`, `role-options` (datalist)

This task is DOM code and cannot be unit-tested in Node (no DOM library in the project — do **not** add one). Verification = structure test + syntax check + manual browser check.

- [ ] **Step 1: Extend `tests/check-structure.js`**

Append the new ids to `requiredIds` (`'role-ceilings-grid', 'role-ceilings-add-row-btn', 'role-ceilings-reset-btn', 'working-days-input', 'working-days-hint', 'people-roles-grid', 'people-roles-add-row-btn', 'role-options'`) and add at the end of the file:

```js
// Both <script> blocks must at least parse (a typo in the IIFE would
// otherwise only show up in a browser).
const scriptBlocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
let syntaxOk = true;
scriptBlocks.forEach((block, i) => {
  const code = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  try { new Function(code); } catch (e) { syntaxOk = false; console.log('FAIL - script block ' + (i + 1) + ' has a syntax error: ' + e.message); process.exitCode = 1; }
});
if (syntaxOk) console.log('ok - all inline script blocks parse');
```

Run: `node tests/check-structure.js` → FAIL (ids missing).

- [ ] **Step 2: Markup, CSS**

Insert **between** the Timesheet Input `</section>` and `<div class="run-row">`:

```html
<section class="card">
  <div class="card-head"><span class="step-badge">3</span><h2>Role Ceilings</h2></div>
  <p class="card-desc">เพดาน Man-Day ต่อคนต่อเดือนของแต่ละตำแหน่ง (Z01-Z03 / CAPEX / OPEX) — ใช้เลือกว่าจะแก้ Timesheet ของใครเมื่อ squad มี OPEX เกิน 80% แก้ไขได้และระบบจำให้ เพดานจริง = ค่าในตาราง × วันทำงาน ÷ 20</p>
  <div id="role-ceilings-grid"></div>
  <button id="role-ceilings-add-row-btn" class="btn btn-add-row" type="button">+ เพิ่มแถว</button>
  <div class="row">
    <button id="role-ceilings-reset-btn" class="btn" type="button">คืนค่าเริ่มต้น</button>
    <label class="status-text" for="working-days-input">วันทำงานเดือนนี้:</label>
    <input id="working-days-input" type="number" min="1" max="31" step="1">
    <span id="working-days-hint" class="status-text"></span>
  </div>
</section>

<section class="card">
  <div class="card-head"><span class="step-badge">4</span><h2>People &rarr; Role</h2></div>
  <p class="card-desc">ใส่ชื่อ (ตรงกับ Name-Surname ใน Timesheet) และตำแหน่งของแต่ละคน — วางจาก Excel ได้ ระบบจำให้ เดือนถัดไปไม่ต้องกรอกใหม่ คนที่ยังไม่มีตำแหน่งจะไม่ถูกเลือกมาแก้</p>
  <div id="people-roles-grid"></div>
  <button id="people-roles-add-row-btn" class="btn btn-add-row" type="button">+ เพิ่มแถว</button>
  <datalist id="role-options"></datalist>
</section>
```

In the `<style>` block (just before `</style>`) add:

```css
  [hidden] { display: none !important; }
  #working-days-input { width: 72px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; }
```

- [ ] **Step 3: IIFE wiring**

(a) In `buildGridDataRow`, after `if (col.cellClass) el.classList.add(col.cellClass);` add:
`if (col.datalistId) el.setAttribute('list', col.datalistId);`

(b) Add element consts near the other `getElementById` consts at the top of the IIFE:

```js
  const roleCeilingsMount = document.getElementById('role-ceilings-grid');
  const roleCeilingsAddRowBtn = document.getElementById('role-ceilings-add-row-btn');
  const roleCeilingsResetBtn = document.getElementById('role-ceilings-reset-btn');
  const workingDaysInput = document.getElementById('working-days-input');
  const workingDaysHint = document.getElementById('working-days-hint');
  const peopleRolesMount = document.getElementById('people-roles-grid');
  const peopleRolesAddRowBtn = document.getElementById('people-roles-add-row-btn');
  const roleOptions = document.getElementById('role-options');
```

(c) After the `timesheetGrid` creation block (and before the `try { const saved = localStorage…` mapping restore), add:

```js
  const ROLE_CEILINGS_STORAGE_KEY = 'woTimesheetSummary.roleCeilings';
  const PEOPLE_ROLES_STORAGE_KEY = 'woTimesheetSummary.peopleRoles';
  const ROLE_CEILING_COLUMNS = [
    { label: 'Role', type: 'text', width: '240px' },
    { label: 'Z01-Z03 (MD)', type: 'text', width: '110px', numeric: true },
    { label: 'CAPEX (MD)', type: 'text', width: '110px', numeric: true },
    { label: 'OPEX (MD)', type: 'text', width: '110px', numeric: true }
  ];
  const PEOPLE_ROLE_COLUMNS = [
    { label: 'Name-Surname', type: 'text', width: '240px' },
    { label: 'Role', type: 'text', width: '240px', datalistId: 'role-options' }
  ];

  function loadSavedRows(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v; }
    } catch (e) { /* localStorage unavailable or corrupt, use defaults */ }
    return null;
  }
  function saveRows(key, rows) {
    try { localStorage.setItem(key, JSON.stringify(rows)); } catch (e) { /* ignore */ }
  }
  function refreshRoleOptions() {
    roleOptions.innerHTML = '';
    roleCeilingsGrid.getRows().forEach(r => {
      const role = String(r[0] || '').trim();
      if (!role) return;
      const o = document.createElement('option');
      o.value = role;
      roleOptions.appendChild(o);
    });
  }

  const roleCeilingsGrid = createGridEditor(roleCeilingsMount, ROLE_CEILING_COLUMNS, roleCeilingsAddRowBtn, 1, () => {
    saveRows(ROLE_CEILINGS_STORAGE_KEY, roleCeilingsGrid.getRows());
    refreshRoleOptions();
  });
  roleCeilingsGrid.setRows(loadSavedRows(ROLE_CEILINGS_STORAGE_KEY) || DEFAULT_ROLE_CEILINGS.map(r => r.slice()));
  refreshRoleOptions();
  roleCeilingsResetBtn.addEventListener('click', () => {
    roleCeilingsGrid.setRows(DEFAULT_ROLE_CEILINGS.map(r => r.slice()));
    saveRows(ROLE_CEILINGS_STORAGE_KEY, roleCeilingsGrid.getRows());
    refreshRoleOptions();
  });

  const peopleRolesGrid = createGridEditor(peopleRolesMount, PEOPLE_ROLE_COLUMNS, peopleRolesAddRowBtn, 3, () => {
    saveRows(PEOPLE_ROLES_STORAGE_KEY, peopleRolesGrid.getRows());
  });
  peopleRolesGrid.setRows(loadSavedRows(PEOPLE_ROLES_STORAGE_KEY) || []);

  // Working days this month: auto-counted (Mon-Fri) from the month of an
  // uploaded sheet, otherwise from the current month; the user can overwrite
  // it (e.g. to remove public holidays).
  function setWorkingDaysFromMonth(ym, sourceLabel) {
    workingDaysInput.value = String(countWorkingDays(ym.year, ym.month));
    workingDaysHint.textContent = 'นับวันจันทร์–ศุกร์ของ ' + (ym.month + 1) + '/' + ym.year + ' (' + sourceLabel + ') — แก้ได้ถ้ามีวันหยุดนักขัตฤกษ์';
  }
  function workingDaysValue() {
    const n = Number(workingDaysInput.value);
    return n > 0 ? n : null;
  }
  workingDaysInput.addEventListener('input', () => { workingDaysHint.textContent = 'แก้เอง'; });
  (function () { const now = new Date(); setWorkingDaysFromMonth({ year: now.getFullYear(), month: now.getMonth() }, 'เดือนปัจจุบัน'); })();
```

(d) In the xlsx upload handler replace

```js
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 'A3:AJ13', blankrows: false, defval: '' });
```
with
```js
        // Read from row 3 until the first row with neither Name nor WO No.
        // (the template leaves a gap before its summary tables).
        const rows = takeTimesheetRows(XLSX.utils.sheet_to_json(sheet, { header: 1, range: 2, blankrows: true, defval: '' }));
        const f2 = sheet['F2'];
        const ym = monthFromSheetValue(f2 ? f2.v : null);
        if (ym) setWorkingDaysFromMonth(ym, 'จากไฟล์ที่อัปโหลด');
```
Also update the comment/status text if it mentions 11 rows (leave other behaviour unchanged).

- [ ] **Step 4: Run tests**

Run: `node tests/all.js` → `ALL TEST FILES PASSED` (including `ok - all inline script blocks parse`).

- [ ] **Step 5: Manual browser check** (open `index.html` via `file://`, internet needed for the xlsx CDN)

1. Two new cards appear; Role Ceilings shows 16 rows; edit a number, reload → value persists; "คืนค่าเริ่มต้น" restores it.
2. Type `Dev` in People → Role's Role cell → datalist suggests roles. Reload → rows persist.
3. Working days shows the current month's Mon–Fri count. Upload `krungsri.xlsx` → shows **21** with hint "8/2026 (จากไฟล์ที่อัปโหลด)", and the timesheet grid shows the same 10 data rows as before.
4. Browser console shows no errors.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/check-structure.js
git commit -m "feat: add Role Ceilings / People→Role inputs, working days, and read all rows on xlsx upload" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI — Rebalance card (suggest, target dropdown, Continue, Apply, Undo, persistence)

**Files:**
- Modify: `index.html` (markup, CSS, IIFE)
- Modify: `tests/check-structure.js` (add ids `rebalance-card`, `rebalance-container`)

**Interfaces:**
- Consumes (Task 3/4/5): `planRebalance`, `applyMoves`, `parseRoleCeilings`, `parsePeopleRoles`, `parseMappingText`, `countWorkingDays`, `roleCeilingsGrid`, `peopleRolesGrid`, `workingDaysValue()`, existing `remainingState`, `parseRemainingValue`, `timesheetGrid`, `serializeGridToTSV`, `TIMESHEET_COLUMNS`, `formatPct`, `escapeHtml`, `OPEX_PCT_ALERT_THRESHOLD`
- Produces (IIFE-scope, used by Task 7): `rebalanceState` (`null | { original: string[][], moves: object[] }`), `clearRebalanceState()`, `renderRebalance()`, `setTimesheetRows(rows)`

- [ ] **Step 1: Markup + CSS**

Insert after the Table 2 `</section>` (before the xlsx `<script src=…>`):

```html
<section class="card" id="rebalance-card" hidden>
  <div class="card-head"><h2>Rebalance &middot; ลด OPEX ให้ไม่เกิน 80%</h2></div>
  <div id="rebalance-container"></div>
</section>
```
CSS (before `</style>`):
```css
  td.cell-changed { background: var(--warn-bg); color: var(--warn-text); font-weight: 600; }
  #rebalance-container select { padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; }
  #rebalance-container .banner { margin-bottom: 8px; }
  #rebalance-container .row { margin-top: 12px; }
```

- [ ] **Step 2: IIFE state and persistence**

Near `let lastTable2 = null;` add:
```js
  const REBALANCE_STORAGE_KEY = 'woTimesheetSummary.rebalance';
  const TIMESHEET_STORAGE_KEY = 'woTimesheetSummary.timesheetText';
  // After the first Apply: { original: <grid rows before any edit>, moves: <every applied move> }.
  let rebalanceState = null;
  let rebalanceIncludeRound2 = false;
  let rebalanceOverrides = {};
  const rebalanceCard = document.getElementById('rebalance-card');
  const rebalanceContainer = document.getElementById('rebalance-container');
  try {
    const rawRb = localStorage.getItem(REBALANCE_STORAGE_KEY);
    if (rawRb) {
      const v = JSON.parse(rawRb);
      if (v && Array.isArray(v.original) && Array.isArray(v.moves)) rebalanceState = v;
    }
  } catch (e) { /* ignore corrupt saved state */ }
```
Change `const OPEX_PCT_ALERT_THRESHOLD = 0.8;` to `const OPEX_PCT_ALERT_THRESHOLD = OPEX_THRESHOLD;`.

Add these functions (anywhere after the `timesheetGrid` definition, e.g. right before the `runBtn.addEventListener('click'` block):

```js
  function saveRebalanceState() {
    try { localStorage.setItem(REBALANCE_STORAGE_KEY, JSON.stringify(rebalanceState)); } catch (e) { /* ignore */ }
  }
  function persistTimesheetText() {
    try { localStorage.setItem(TIMESHEET_STORAGE_KEY, timesheetInput.value); } catch (e) { /* ignore */ }
  }
  function clearRebalanceState() {
    rebalanceState = null;
    rebalanceIncludeRound2 = false;
    rebalanceOverrides = {};
    try {
      localStorage.removeItem(REBALANCE_STORAGE_KEY);
      localStorage.removeItem(TIMESHEET_STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }
  function setTimesheetRows(rows) {
    timesheetGrid.setRows(rows);
    timesheetInput.value = serializeGridToTSV(TIMESHEET_COLUMNS.map(c => c.label), timesheetGrid);
  }
```

Modify the `timesheetGrid` onChange callback (the arrow function passed to `createGridEditor(timesheetGridMount, …)`) to also call `if (rebalanceState) persistTimesheetText();` after the `dispatchEvent` line.

Right after `populateGridFromTSV(mappingGrid, mappingInput.value);` add the restore-on-load:
```js
  if (rebalanceState) {
    try {
      const savedTs = localStorage.getItem(TIMESHEET_STORAGE_KEY);
      if (savedTs) { timesheetInput.value = savedTs; populateGridFromTSV(timesheetGrid, savedTs); }
    } catch (e) { /* ignore */ }
  }
```
(Timesheet text is persisted only while a rebalance is active — that is what keeps "original vs new" intact across a reload; otherwise behaviour is unchanged.)

- [ ] **Step 3: Planner context + render**

```js
  function buildRebalanceCtx(rows, mapping) {
    const remainingLast = {};
    Object.keys(remainingState.lastMonth).forEach(k => {
      const v = parseRemainingValue(remainingState.lastMonth[k]);
      if (v != null) remainingLast[k] = v;
    });
    const now = new Date();
    return {
      rowArrays: rows,
      mapping: mapping,
      roleMap: parsePeopleRoles(peopleRolesGrid.getRows()),
      ceilings: parseRoleCeilings(roleCeilingsGrid.getRows()).map,
      workingDays: workingDaysValue() || countWorkingDays(now.getFullYear(), now.getMonth()),
      remainingLast: remainingLast,
      threshold: OPEX_PCT_ALERT_THRESHOLD
    };
  }

  function currentPlan() {
    return planRebalance(
      buildRebalanceCtx(timesheetGrid.getRows(), parseMappingText(mappingInput.value)),
      { includeRound2: rebalanceIncludeRound2, targetOverrides: rebalanceOverrides }
    );
  }

  function fmtMD(mh) { return (Math.round(mh * 100) / 100).toString(); }

  function renderRebalance() {
    const plan = currentPlan();
    const flagged = plan.squads.filter(s => s.status !== 'ok');
    if (flagged.length === 0 && !rebalanceState) {
      rebalanceCard.hidden = true;
      rebalanceContainer.innerHTML = '';
      return;
    }
    rebalanceCard.hidden = false;
    let html = '';

    if (flagged.length > 0) {
      html += '<p class="card-desc">เพดานคำนวณจากวันทำงาน ' + escapeHtml(String(workingDaysValue() || '-')) + ' วัน (× วันทำงาน ÷ 20) — เลือกคนที่ลง OPEX เกินเพดานของตำแหน่งก่อน ย้ายเท่าที่จำเป็นให้ squad ไม่เกิน 80%</p>';
    }
    flagged.forEach(s => {
      const before = formatPct(s.beforePct), after = formatPct(s.afterPct);
      if (s.status === 'fixed') {
        html += '<p class="card-desc">✓ ' + escapeHtml(s.sq) + ': OPEX ' + before + ' → ' + after + '</p>';
      } else if (s.status === 'needs-continue') {
        html += '<div class="banner warn">' + escapeHtml(s.sq) + ' ยังเหลือ OPEX ' + after + ' หลังย้ายตามเพดานของตำแหน่ง (รอบที่ 1) — กด "ทำต่อ" เพื่อลองย้ายคนที่ยังมีที่ว่างใน CAPEX (รอบที่ 2)</div>';
      } else {
        html += '<div class="banner warn">' + escapeHtml(s.sq) + ' ยังเหลือ OPEX ' + after + ' ไม่สามารถแก้ได้ภายในเพดานของตำแหน่ง — ต้องแก้ด้วยตนเองใน Timesheet</div>';
      }
    });
    if (plan.skipped.length > 0) {
      html += '<div class="banner warn">ข้ามคนที่ระบบแก้ให้ไม่ได้: ' +
        plan.skipped.map(s => escapeHtml(s.name || '(ไม่มีชื่อ)') + ' (' + escapeHtml(s.reason) + ')').join(', ') + '</div>';
    }

    if (plan.lines.length > 0) {
      html += '<div class="table-scroll"><table><thead><tr><th>ชื่อ</th><th>ตำแหน่ง</th><th>Squad</th><th>OPEX (MD) / เพดาน</th><th>ย้าย (MH)</th><th>จาก WO</th><th>ไป CAPEX WO</th><th>รอบ</th></tr></thead><tbody>';
      plan.lines.forEach(l => {
        const opts = l.targetOptions.map(o =>
          '<option value="' + escapeHtml(o.woKey) + '"' + (o.woKey === l.toWoKey ? ' selected' : '') + '>' + escapeHtml(o.woNo + (o.woName && o.woName !== o.woNo ? ' — ' + o.woName : '')) + '</option>').join('');
        html += '<tr><td>' + escapeHtml(l.name) + '</td><td>' + escapeHtml(l.role) + '</td><td>' + escapeHtml(l.sq) + '</td>' +
          '<td>' + fmtMD(l.opexMDBefore) + ' / ' + fmtMD(l.opexCeilingMD) + '</td>' +
          '<td>' + fmtMD(l.movedMH) + (l.error ? ' ⚠ ' + escapeHtml(l.error) : '') + '</td>' +
          '<td>' + escapeHtml(l.fromWoNos.join(', ')) + '</td>' +
          '<td><select class="rb-target" data-name-key="' + escapeHtml(l.nameKey) + '">' + opts + '</select></td>' +
          '<td>' + (l.movedMH === 0 ? '' : l.round) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    if (flagged.length > 0) {
      const needsContinue = flagged.some(s => s.status === 'needs-continue');
      html += '<div class="row"><button type="button" class="btn btn-primary" data-rb-action="apply"' + (plan.moves.length ? '' : ' disabled') + '>Apply</button>';
      if (needsContinue) html += '<button type="button" class="btn" data-rb-action="continue">ทำต่อ (รอบที่ 2)</button>';
      html += '</div>';
    }
    if (rebalanceState) {
      html += '<p class="card-desc">แก้ Timesheet แล้ว — เก็บฉบับเดิมไว้ให้แล้ว</p>' +
        '<div class="row"><button type="button" class="btn" data-rb-action="undo">Undo (คืนค่าเดิมทั้งหมด)</button></div>';
    }
    rebalanceContainer.innerHTML = html;
  }

  function applyRebalance() {
    const rows = timesheetGrid.getRows();
    const plan = currentPlan();
    if (plan.moves.length === 0) return;
    if (!rebalanceState) rebalanceState = { original: rows.map(r => r.slice()), moves: [] };
    rebalanceState.moves = rebalanceState.moves.concat(plan.moves);
    saveRebalanceState();
    setTimesheetRows(applyMoves(rows, plan.moves));
    persistTimesheetText();
    rebalanceIncludeRound2 = false;
    rebalanceOverrides = {};
    runBtn.click();
  }

  function undoRebalance() {
    if (!rebalanceState) return;
    setTimesheetRows(rebalanceState.original);
    clearRebalanceState();
    runBtn.click();
  }

  rebalanceContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rb-action]');
    if (!btn) return;
    const action = btn.dataset.rbAction;
    if (action === 'apply') applyRebalance();
    else if (action === 'undo') undoRebalance();
    else if (action === 'continue') { rebalanceIncludeRound2 = true; renderRebalance(); }
  });
  rebalanceContainer.addEventListener('change', (e) => {
    if (!e.target.classList.contains('rb-target')) return;
    rebalanceOverrides[e.target.dataset.nameKey] = e.target.value;
    renderRebalance();
  });
```
- [ ] **Step 4: Hook into Run**

In the `runBtn` click handler:
- at the very top (right after `clearBanners();`) add `rebalanceCard.hidden = true; rebalanceIncludeRound2 = false; rebalanceOverrides = {};`
- as the last statement (after `lastTable2 = table2;`) add `renderRebalance();`

In the xlsx upload handler (right after the file is read successfully, next to `populateGridFromTSV(timesheetGrid, …)`) add `clearRebalanceState(); rebalanceCard.hidden = true;`. In the `newMonthBtn` click handler, after `saveRemainingState();` add `clearRebalanceState(); rebalanceCard.hidden = true;`.

- [ ] **Step 5: Structure test + all tests**

Add `'rebalance-card', 'rebalance-container'` to `requiredIds` in `tests/check-structure.js`. Run `node tests/all.js` → `ALL TEST FILES PASSED`.

- [ ] **Step 6: Manual browser check**

Setup: WO Mapping `C1 CAPEX`, `C2 CAPEX`, `O1 OPEX`; People → Role: `Dev1 → Developer`, `Dev2 → Developer`; paste in the Timesheet grid (day values in Day columns) the Scenario "round 1 starts with whoever is furthest over" rows from `tests/rebalance.js` (Dev2: O1 days 1–10 = 8, C1 day 11 = 8; Dev1: O1 days 1–4 = 8, C1 days 11–12 = 8).
1. Run → Table 2 shows S1 OPEX 82.35% in red; Rebalance card lists only **Dev2**, MH to move **4**, target `C1`; Apply is enabled.
2. Change the dropdown to `C2` → line updates (target C2); change back to C1.
3. Click Apply → grid changes (Dev2 O1 day 10 = 4, C1 day 10 = 4), Table 2 OPEX ≤ 80%, card shows "แก้ Timesheet แล้ว" + Undo.
4. Reload the page → grid still shows the **edited** timesheet and the card still offers Undo.
5. Click Undo → grid is back to the original numbers; card disappears after Run re-renders (S1 is >80% again, so the card shows suggestions again).
6. Set Dev1/Dev2 to role `Incident Management Engineer` → squad shows the "ทำต่อ" warning; click "ทำต่อ" → it becomes the "ไม่สามารถแก้ได้…" warning; Apply stays disabled.
7. Console shows no errors.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/check-structure.js
git commit -m "feat: add Rebalance card with suggestions, target WO dropdown, Continue, Apply and Undo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: UI — report output (before → after, OPEX % เดิม, change log, timesheet downloads)

**Files:**
- Modify: `index.html` (markup, IIFE)
- Modify: `tests/check-structure.js`

**Interfaces:**
- Consumes (Task 2/4/6): `summarizeRows`, `diffCell`, `table2ToRows(table2, before)`, `buildChangeLog`, `timesheetToAoa`, `rebalanceState`, `clearRebalanceState`, `renderRebalance`, existing `renderTable1/renderTable2`, `buildTable2ClipboardHTML`, `clipCell`, `copyRows`, `downloadRows`
- Produces: ids `changelog-card`, `changelog-container`, `copy-changelog-btn`, `download-changelog-btn`; rebalance-card buttons `data-rb-action="dl-original"` / `"dl-new"`

- [ ] **Step 1: Markup**

Insert after the Rebalance card `</section>`:

```html
<section class="card" id="changelog-card" hidden>
  <div class="card-head"><h2>ประวัติการแก้ไข Timesheet</h2></div>
  <div class="table-actions">
    <button id="copy-changelog-btn" class="btn" type="button">Copy</button>
    <button id="download-changelog-btn" class="btn" type="button">Download CSV</button>
  </div>
  <div id="changelog-container" class="table-scroll"></div>
</section>
```
Add `'changelog-card', 'changelog-container', 'copy-changelog-btn', 'download-changelog-btn'` to `requiredIds` in `tests/check-structure.js`.

- [ ] **Step 2: Before-tables state and Table 1 / Table 2 rendering**

Add `let lastBefore = null;` (holds `{ table1, table2 }` of the original timesheet, or `null`) next to `lastTable2`.

Change `renderTable1(table1)` to `renderTable1(table1, beforeTable1)`. Replace the squad-row cell line
```js
        html += '<td>' + formatMH(table1.cellMatrix[sq][col.key] || 0) + '</td>';
```
with
```js
        const d = beforeTable1
          ? diffCell((beforeTable1.cellMatrix[sq] || {})[col.key] || 0, table1.cellMatrix[sq][col.key] || 0)
          : { changed: false, text: formatMH(table1.cellMatrix[sq][col.key] || 0) };
        html += '<td' + (d.changed ? ' class="cell-changed"' : '') + '>' + d.text + '</td>';
```
and the Summary row cell line
```js
    table1.columns.forEach(col => { html += '<td>' + formatMH(table1.colTotals[col.key]) + '</td>'; });
```
with
```js
    table1.columns.forEach(col => {
      const d = beforeTable1
        ? diffCell(beforeTable1.colTotals[col.key] || 0, table1.colTotals[col.key])
        : { changed: false, text: formatMH(table1.colTotals[col.key]) };
      html += '<td' + (d.changed ? ' class="cell-changed"' : '') + '>' + d.text + '</td>';
    });
```
(Copy/Download of Table 1 stays after-fix numbers only — `buildTable1ClipboardHTML`/`table1ToRows` are untouched.)

Change `renderTable2(table2)` to `renderTable2(table2, beforeTable2)`: when `beforeTable2` is given, add a header `<th>OPEX % (เดิม)</th>` and a last cell per row `<td>` + `formatPct(before opexPct for that squad, or null)` + `</td>` (look the squad up in `beforeTable2` by `sq`).

Change `buildTable2ClipboardHTML(table2)` to `buildTable2ClipboardHTML(table2, beforeTable2)` and, when `beforeTable2` is given, add a header cell `clipCell('td', 'OPEX % (เดิม)', categoryBg('OPEX'), 'right', true)` and a last cell per row with the original OPEX % (`formatPct`, `'#ffffff'` background, right-aligned, not bold).

- [ ] **Step 3: Run handler**

In the `runBtn` click handler: after `const table2 = buildTable2(classified.rows);` compute
```js
    lastBefore = rebalanceState ? summarizeRows(rebalanceState.original, mapping) : null;
```
and change the render calls / row builders to
```js
    renderTable1(table1, lastBefore && lastBefore.table1);
    renderTable2(table2, lastBefore && lastBefore.table2);
    ...
    lastTable2Rows = table2ToRows(table2, lastBefore && lastBefore.table2);
```
Also reset `lastBefore = null;` where the handler resets `lastTable1 = null;` etc., and update the Table 2 Copy listener to
`copyRows(lastTable2Rows, lastTable2 ? buildTable2ClipboardHTML(lastTable2, lastBefore && lastBefore.table2) : '', copyTable2Btn)`.

In the `newMonthBtn` handler (after `clearRebalanceState()`), set `lastBefore = null;`, call `if (lastTable2) renderTable2(lastTable2);`, rebuild `lastTable2Rows = table2ToRows(lastTable2)` when `lastTable2` exists, and hide the change-log card (`changelogCard.hidden = true`). Do the same hiding + `lastBefore = null` in the xlsx upload handler and in `undoRebalance()` (before it calls `runBtn.click()` — `clearRebalanceState` already ran there).

- [ ] **Step 4: Change log + downloads**

Add consts `changelogCard`, `changelogContainer`, `copyChangelogBtn`, `downloadChangelogBtn` (by id). Add:

```js
  let lastChangeLogRows = null;

  function renderChangeLog() {
    if (!rebalanceState || rebalanceState.moves.length === 0) {
      changelogCard.hidden = true;
      changelogContainer.innerHTML = '';
      lastChangeLogRows = null;
      return;
    }
    const log = buildChangeLog(rebalanceState.moves);
    lastChangeLogRows = log;
    let html = '<table><thead><tr>' + log.header.map(h => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>';
    log.rows.forEach(r => { html += '<tr>' + r.map(c => '<td>' + escapeHtml(typeof c === 'number' ? (Math.round(c * 100) / 100) : c) + '</td>').join('') + '</tr>'; });
    html += '</tbody></table>';
    changelogContainer.innerHTML = html;
    changelogCard.hidden = false;
  }

  function buildChangeLogClipboardHTML(log) {
    let html = '<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;"><tr>' +
      log.header.map(h => clipCell('td', h, GRID_HEADER_BG, 'left', true)).join('') + '</tr>';
    log.rows.forEach(r => {
      html += '<tr>' + r.map((c, i) => clipCell('td', typeof c === 'number' ? String(Math.round(c * 100) / 100) : c, '#ffffff', i >= 4 ? 'right' : 'left', false)).join('') + '</tr>';
    });
    return html + '</table>';
  }

  copyChangelogBtn.addEventListener('click', () => copyRows(lastChangeLogRows, lastChangeLogRows ? buildChangeLogClipboardHTML(lastChangeLogRows) : '', copyChangelogBtn));
  downloadChangelogBtn.addEventListener('click', () => downloadRows(lastChangeLogRows, 'wo-changelog'));

  function downloadTimesheetXlsx(rows, prefix) {
    if (typeof XLSX === 'undefined') { addBanner('error', 'โหลดไลบรารี xlsx ไม่สำเร็จ จึงดาวน์โหลดไฟล์ .xlsx ไม่ได้'); return; }
    const ws = XLSX.utils.aoa_to_sheet(timesheetToAoa(rows));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, prefix + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
```
Call `renderChangeLog();` at the end of the `runBtn` handler (after `renderRebalance();`).

In `renderRebalance()`, extend the `if (rebalanceState)` block with two more buttons inside the same `.row`:
```js
        '<button type="button" class="btn" data-rb-action="dl-original">ดาวน์โหลด Timesheet ฉบับเดิม (.xlsx)</button>' +
        '<button type="button" class="btn" data-rb-action="dl-new">ดาวน์โหลด Timesheet ฉบับใหม่ (.xlsx)</button>'
```
and in the card's click handler add
```js
    else if (action === 'dl-original' && rebalanceState) downloadTimesheetXlsx(rebalanceState.original, 'timesheet-original');
    else if (action === 'dl-new') downloadTimesheetXlsx(timesheetGrid.getRows(), 'timesheet-new');
```

- [ ] **Step 5: Run tests**

Run: `node tests/all.js` → `ALL TEST FILES PASSED`.

- [ ] **Step 6: Manual browser check** (reuse the Task 6 setup)

1. Run, Apply. Table 1: the Dev2 `O1` and `C1` cells for S1 and the Summary cells of those columns show `10.00 → 9.50`-style text on a highlighted background; other cells unchanged.
2. Table 2: an `OPEX % (เดิม)` column shows 82.35% while `OPEX %` shows the new value (≤ 80%, no red).
3. Copy Table 1 → paste into Excel/Sheets: plain after-fix numbers (no arrows). Copy Table 2 → includes the `OPEX % (เดิม)` column.
4. Change-log card lists one row per (person, from, to, day) with summed MH; Copy / Download CSV work.
5. "ดาวน์โหลด Timesheet ฉบับเดิม" and "…ฉบับใหม่" download two `.xlsx` files; open them: row 1 blank, row 2 header, data from row 3; re-uploading either file loads the same rows.
6. Undo → before/after columns and change-log card disappear. "ขึ้นเดือนใหม่" and a new `.xlsx` upload also clear them.
7. Console shows no errors.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/check-structure.js
git commit -m "feat: show before→after in Table 1/2, change log, and original/new timesheet downloads" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
