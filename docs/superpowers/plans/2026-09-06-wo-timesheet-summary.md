# WO Timesheet Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single self-contained `index.html` file that takes a pasted/uploaded timesheet plus a pasted WO→category mapping, classifies every WO as CAPEX / OPEX / Non Charge / Unmapped, renders the Squad×WO cross-tab and the %CAPEX/%OPEX summary tables, and lets the user copy them (TSV, paste-ready into Excel) or download them as CSV.

**Architecture:** One HTML file with two `<script>` blocks: a dependency-free "app-logic" block holding pure functions (parsing, classification, table building, formatting, CSV/TSV encoding) that double as a Node-testable module via an isomorphic `module.exports` guard, and a "wiring" block that only touches the DOM (event listeners, rendering, clipboard, file download). All processing is client-side; no timesheet data is ever sent anywhere.

**Tech Stack:** Vanilla JS (ES6, no framework), SheetJS (`xlsx`) from a CDN for `.xlsx` upload parsing, Node.js (already installed, v24) purely as the dev-time test runner via its built-in `vm`/`assert` modules — zero npm packages.

## Global Constraints

- Deliverable is a single file, `index.html`, opened directly in a browser — no server, no build step, no bundler.
- All computation happens client-side; no timesheet data (names, hours) is ever transmitted anywhere.
- WO No.s absent from the mapping table go into a separate `⚠ Unmapped` group — never silently defaulted to CAPEX or any other category.
- Category matching is case/space/hyphen-insensitive; recognized categories: `CAPEX`, `OPEX`, `NON CHARGE` (and the source file's typo `Nonchargable`).
- Internal sums keep full floating-point precision; on-screen MH values display with 2 decimals, % values with 1 decimal; Copy/CSV export the full-precision numbers, not the rounded display strings.
- CSV downloads are UTF-8 with a BOM; Copy-to-clipboard uses tab-separated values so pasting lands in the right Excel columns.
- Errors/warnings (missing input, skipped rows, unmapped WOs) are shown as inline banners, never `alert()` popups, and never abort silently.

---

### Task 1: Project setup + core input parsing

**Files:**
- Create: `index.html`
- Create: `tests/load-app.js`
- Create: `tests/run-tests.js`

**Interfaces:**
- Produces (exported from `index.html`'s `<script id="app-logic">` block, consumed by later tasks and by `tests/load-app.js`):
  - `normalizeWO(s: string): string`
  - `normalizeCategory(s: string): 'CAPEX' | 'OPEX' | 'NON_CHARGE' | null`
  - `parseMappingText(text: string): { map: { [normalizedWO: string]: { wo: string, category: string, name: string } }, skippedLines: number[] }`
  - `rowsFromPastedText(text: string): string[][]`
  - `parseNum(v: any): { ok: boolean, value: number }`
  - `parseDataRows(rowArrays: string[][]): { rows: Array<{ rowNumber: number, name: string, sq: string, woNo: string, woName: string, mh: number }>, skippedRows: number[] }`

- [ ] **Step 1: Initialize the project as a git repository**

Run: `git init` (from `D:/02_Work/code_project/time_sheert`)
Expected: `Initialized empty Git repository in .../\.git/`

- [ ] **Step 2: Create `index.html` with the app-logic skeleton and the first parsing functions**

```html
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>WO Timesheet Summary</title>
</head>
<body>

<script id="app-logic">
"use strict";

function normalizeWO(s) {
  return String(s == null ? '' : s).trim().toUpperCase();
}

function normalizeCategory(s) {
  const key = String(s == null ? '' : s).trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (key === 'CAPEX') return 'CAPEX';
  if (key === 'OPEX') return 'OPEX';
  if (key === 'NONCHARGE' || key === 'NONCHARGEABLE' || key === 'NONCHARGABLE') return 'NON_CHARGE';
  return null;
}

function parseMappingText(text) {
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  const map = {};
  const skippedLines = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cells = line.split('\t').map(c => c.trim());
    if (cells.length < 2) { skippedLines.push(i + 1); return; }
    const category = normalizeCategory(cells[1]);
    const key = normalizeWO(cells[0]);
    if (!category || !key) { skippedLines.push(i + 1); return; }
    map[key] = { wo: cells[0], category: category, name: cells[2] || '' };
  });
  return { map: map, skippedLines: skippedLines };
}

function rowsFromPastedText(text) {
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  return lines.slice(1).map(line => line.split('\t'));
}

function parseNum(v) {
  if (v == null) return { ok: true, value: 0 };
  const s = String(v).trim();
  if (s === '') return { ok: true, value: 0 };
  const n = Number(s.replace(/,/g, ''));
  return isNaN(n) ? { ok: false, value: 0 } : { ok: true, value: n };
}

function parseDataRows(rowArrays) {
  const rows = [];
  const skippedRows = [];
  rowArrays.forEach((r, i) => {
    const rowNumber = i + 1;
    if (!r || r.length < 5) { skippedRows.push(rowNumber); return; }
    const name = (r[0] || '').toString().trim();
    const sq = (r[1] || '').toString().trim() || '(Unspecified)';
    const woNo = (r[2] || '').toString().trim();
    const woName = (r[3] || '').toString().trim();
    if (!woNo) { skippedRows.push(rowNumber); return; }
    const daily = r.slice(5, 36);
    let mh = 0;
    let badCell = false;
    for (const cell of daily) {
      const parsed = parseNum(cell);
      if (!parsed.ok) { badCell = true; break; }
      mh += parsed.value;
    }
    if (badCell) { skippedRows.push(rowNumber); return; }
    rows.push({ rowNumber, name, sq, woNo, woName, mh });
  });
  return { rows, skippedRows };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeWO, normalizeCategory, parseMappingText, rowsFromPastedText,
    parseNum, parseDataRows
  };
}
</script>

</body>
</html>
```

- [ ] **Step 3: Create the Node test loader**

```javascript
// tests/load-app.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script id="app-logic">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not find <script id="app-logic"> block in index.html');
  const code = match[1];
  const sandbox = { module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app-logic.js' });
  return sandbox.module.exports;
}

module.exports = { loadApp };
```

This extracts the `app-logic` script block out of `index.html` and runs it in a sandboxed Node context, so the same code that ships to the browser is what gets unit-tested — no duplication, no build step.

- [ ] **Step 4: Write the first test file**

```javascript
// tests/run-tests.js
const assert = require('assert');
const { loadApp } = require('./load-app');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok - ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL - ' + name);
    console.log('    ' + err.message);
  }
}

const App = loadApp();

test('normalizeWO trims and uppercases', () => {
  assert.strictEqual(App.normalizeWO('  z01 '), 'Z01');
});

test('normalizeCategory recognizes CAPEX/OPEX/Non Charge variants', () => {
  assert.strictEqual(App.normalizeCategory('CAPEX'), 'CAPEX');
  assert.strictEqual(App.normalizeCategory('opex'), 'OPEX');
  assert.strictEqual(App.normalizeCategory('Non Charge'), 'NON_CHARGE');
  assert.strictEqual(App.normalizeCategory('Nonchargable'), 'NON_CHARGE');
  assert.strictEqual(App.normalizeCategory('bogus'), null);
});

test('parseMappingText skips header row and blank lines, builds lookup map', () => {
  const text = 'WO No.\tCategory\tWO Name\nCAPEX-001\tCAPEX\tONE Corporate MVP1\n\nZ01\tNon Charge\tLeave / Day-Off';
  const result = App.parseMappingText(text);
  assert.deepStrictEqual(result.skippedLines, [1]);
  assert.deepStrictEqual(result.map['CAPEX-001'], { wo: 'CAPEX-001', category: 'CAPEX', name: 'ONE Corporate MVP1' });
  assert.deepStrictEqual(result.map['Z01'], { wo: 'Z01', category: 'NON_CHARGE', name: 'Leave / Day-Off' });
});

test('rowsFromPastedText drops the first line as header', () => {
  const text = 'Name\tSQ\tWO\nAlice\tSQ1\tCAPEX-001';
  const rows = App.rowsFromPastedText(text);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], ['Alice', 'SQ1', 'CAPEX-001']);
});

test('parseDataRows sums daily MH and defaults blank SQ', () => {
  const row = ['Alice', '', 'CAPEX-001', 'MVP1', '1', '8', '8', '', '4'];
  const result = App.parseDataRows([row]);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].sq, '(Unspecified)');
  assert.strictEqual(result.rows[0].mh, 20);
  assert.strictEqual(result.skippedRows.length, 0);
});

test('parseDataRows skips rows missing WO No. or with non-numeric MH cells', () => {
  const missingWO = ['Alice', 'SQ1', '', 'MVP1', '1', '8'];
  const badCell = ['Bob', 'SQ1', 'CAPEX-001', 'MVP1', '1', 'x'];
  const result = App.parseDataRows([missingWO, badCell]);
  assert.strictEqual(result.rows.length, 0);
  assert.deepStrictEqual(result.skippedRows, [1, 2]);
});

process.on('exit', () => {
  if (failures > 0) {
    console.log(failures + ' failing test(s)');
    process.exitCode = 1;
  } else {
    console.log('All tests passed');
  }
});
```

- [ ] **Step 5: Run the tests**

Run: `node tests/run-tests.js`
Expected: 6 lines of `ok - ...` and a final `All tests passed` (exit code 0).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/load-app.js tests/run-tests.js
git commit -m "feat: add mapping/timesheet parsing logic with Node test harness

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Classification + summary table builders

**Files:**
- Modify: `index.html` (the `<script id="app-logic">` block)
- Modify: `tests/run-tests.js`

**Interfaces:**
- Consumes: `normalizeWO`, and the row shape produced by `parseDataRows` from Task 1 (`{ rowNumber, name, sq, woNo, woName, mh }`).
- Produces:
  - `classifyRows(rows, mapping): { rows: Array<row & { category: 'CAPEX'|'OPEX'|'NON_CHARGE'|'UNMAPPED', woKey: string, woLabel: string }>, unmappedWOs: string[] }`
  - `CATEGORY_ORDER: string[]` — `['CAPEX', 'OPEX', 'NON_CHARGE', 'UNMAPPED']`
  - `CATEGORY_LABEL: { [category: string]: string }`
  - `buildTable1(classifiedRows): { squads: string[], columns: Array<{key, label, category}>, cellMatrix: {[sq]: {[woKey]: number}}, rowTotals: {[sq]: number}, colTotals: {[woKey]: number}, grandTotal: number }`
  - `buildTable2(classifiedRows): Array<{ sq: string, capexMH: number, opexMH: number, capexPct: number|null, opexPct: number|null }>`

- [ ] **Step 1: Add the new tests (still red at this point)**

Edit `tests/run-tests.js`: insert the following three `test(...)` blocks immediately before the `process.on('exit', ...)` block at the end of the file.

```javascript
test('classifyRows tags UNMAPPED rows and reports unmapped WO numbers', () => {
  const mapping = App.parseMappingText('CAPEX-001\tCAPEX\tMVP1');
  const rows = [
    { rowNumber: 1, name: 'A', sq: 'SQ1', woNo: 'CAPEX-001', woName: '', mh: 10 },
    { rowNumber: 2, name: 'B', sq: 'SQ1', woNo: 'W999', woName: 'Unknown', mh: 5 }
  ];
  const result = App.classifyRows(rows, mapping);
  assert.strictEqual(result.rows[0].category, 'CAPEX');
  assert.strictEqual(result.rows[0].woLabel, 'MVP1');
  assert.strictEqual(result.rows[1].category, 'UNMAPPED');
  assert.deepStrictEqual(result.unmappedWOs, ['W999']);
});

test('buildTable1 groups columns by category and computes totals', () => {
  const classified = [
    { sq: 'SQ1', woKey: 'C1', woLabel: 'C1', category: 'CAPEX', mh: 10 },
    { sq: 'SQ1', woKey: 'O1', woLabel: 'O1', category: 'OPEX', mh: 5 },
    { sq: 'SQ2', woKey: 'C1', woLabel: 'C1', category: 'CAPEX', mh: 3 }
  ];
  const table = App.buildTable1(classified);
  assert.deepStrictEqual(table.squads, ['SQ1', 'SQ2']);
  assert.deepStrictEqual(table.columns.map(c => c.key), ['C1', 'O1']);
  assert.strictEqual(table.cellMatrix.SQ1.C1, 10);
  assert.strictEqual(table.cellMatrix.SQ2.C1, 3);
  assert.strictEqual(table.rowTotals.SQ1, 15);
  assert.strictEqual(table.rowTotals.SQ2, 3);
  assert.strictEqual(table.colTotals.C1, 13);
  assert.strictEqual(table.grandTotal, 18);
});

test('buildTable2 computes chargeable percentages and nulls out squads with no chargeable MH', () => {
  const classified = [
    { sq: 'SQ1', category: 'CAPEX', mh: 6 },
    { sq: 'SQ1', category: 'OPEX', mh: 2 },
    { sq: 'SQ2', category: 'NON_CHARGE', mh: 4 }
  ];
  const table = App.buildTable2(classified);
  const sq1 = table.find(r => r.sq === 'SQ1');
  const sq2 = table.find(r => r.sq === 'SQ2');
  assert.strictEqual(sq1.capexPct, 0.75);
  assert.strictEqual(sq1.opexPct, 0.25);
  assert.strictEqual(sq2.capexPct, null);
  assert.strictEqual(sq2.opexPct, null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tests/run-tests.js`
Expected: the 3 new tests `FAIL` with `App.classifyRows is not a function` (or similar) while the Task 1 tests still pass.

- [ ] **Step 3: Add the classification and table-building functions to `index.html`**

Edit `index.html`: replace this exact block —

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeWO, normalizeCategory, parseMappingText, rowsFromPastedText,
    parseNum, parseDataRows
  };
}
```

— with:

```javascript
function classifyRows(rows, mapping) {
  const map = mapping.map;
  const unmappedSet = {};
  const classified = rows.map(row => {
    const key = normalizeWO(row.woNo);
    const entry = map[key];
    const category = entry ? entry.category : 'UNMAPPED';
    const woLabel = (entry && entry.name) || row.woName || row.woNo;
    if (!entry) unmappedSet[row.woNo] = true;
    return Object.assign({}, row, { category, woKey: key, woLabel });
  });
  return { rows: classified, unmappedWOs: Object.keys(unmappedSet) };
}

const CATEGORY_ORDER = ['CAPEX', 'OPEX', 'NON_CHARGE', 'UNMAPPED'];
const CATEGORY_LABEL = { CAPEX: 'CAPEX', OPEX: 'OPEX', NON_CHARGE: 'Non Charge', UNMAPPED: '\u26A0 Unmapped' };

function buildTable1(classifiedRows) {
  const squads = [];
  const squadSeen = {};
  classifiedRows.forEach(row => {
    if (!squadSeen[row.sq]) { squadSeen[row.sq] = true; squads.push(row.sq); }
  });

  const columns = [];
  const colSeen = {};
  CATEGORY_ORDER.forEach(cat => {
    classifiedRows.forEach(row => {
      if (row.category !== cat || colSeen[row.woKey]) return;
      colSeen[row.woKey] = true;
      columns.push({ key: row.woKey, label: row.woLabel, category: cat });
    });
  });

  const cellMatrix = {};
  squads.forEach(sq => { cellMatrix[sq] = {}; });
  classifiedRows.forEach(row => {
    cellMatrix[row.sq][row.woKey] = (cellMatrix[row.sq][row.woKey] || 0) + row.mh;
  });

  const rowTotals = {};
  squads.forEach(sq => {
    rowTotals[sq] = columns.reduce((sum, col) => sum + (cellMatrix[sq][col.key] || 0), 0);
  });

  const colTotals = {};
  columns.forEach(col => {
    colTotals[col.key] = squads.reduce((sum, sq) => sum + (cellMatrix[sq][col.key] || 0), 0);
  });

  const grandTotal = squads.reduce((sum, sq) => sum + rowTotals[sq], 0);

  return { squads, columns, cellMatrix, rowTotals, colTotals, grandTotal };
}

function buildTable2(classifiedRows) {
  const order = [];
  const seen = {};
  const capex = {};
  const opex = {};
  classifiedRows.forEach(row => {
    if (!seen[row.sq]) { seen[row.sq] = true; order.push(row.sq); capex[row.sq] = 0; opex[row.sq] = 0; }
    if (row.category === 'CAPEX') capex[row.sq] += row.mh;
    if (row.category === 'OPEX') opex[row.sq] += row.mh;
  });
  return order.map(sq => {
    const c = capex[sq], o = opex[sq];
    const chargeable = c + o;
    return {
      sq,
      capexMH: c,
      opexMH: o,
      capexPct: chargeable > 0 ? c / chargeable : null,
      opexPct: chargeable > 0 ? o / chargeable : null
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeWO, normalizeCategory, parseMappingText, rowsFromPastedText,
    parseNum, parseDataRows, classifyRows, buildTable1, buildTable2,
    CATEGORY_ORDER, CATEGORY_LABEL
  };
}
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `node tests/run-tests.js`
Expected: 9 lines of `ok - ...` and `All tests passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/run-tests.js
git commit -m "feat: add WO classification and cross-tab/percentage table builders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Formatting + CSV/TSV export functions

**Files:**
- Modify: `index.html` (the `<script id="app-logic">` block)
- Modify: `tests/run-tests.js`

**Interfaces:**
- Consumes: `buildTable1`/`buildTable2` output shapes from Task 2.
- Produces:
  - `formatMH(n: number): string` — 2 decimals
  - `formatPct(p: number|null): string` — 1 decimal + `%`, or `–` for `null`
  - `toCSV(header: string[], rows: any[][]): string`
  - `toTSV(header: string[], rows: any[][]): string`
  - `table1ToRows(table1): { header: string[], rows: any[][] }` (full-precision values, includes trailing `Summary` row)
  - `table2ToRows(table2): { header: string[], rows: any[][] }` (full-precision values)

- [ ] **Step 1: Add the new tests**

Edit `tests/run-tests.js`: insert before `process.on('exit', ...)`:

```javascript
test('formatMH rounds to 2 decimals', () => {
  assert.strictEqual(App.formatMH(10), '10.00');
  assert.strictEqual(App.formatMH(10.005), '10.01');
});

test('formatPct renders a dash for null and a percentage otherwise', () => {
  assert.strictEqual(App.formatPct(null), '\u2013');
  assert.strictEqual(App.formatPct(0.6666), '66.7%');
});

test('toCSV quotes values containing commas or quotes', () => {
  const csv = App.toCSV(['Squad', 'Note'], [['SQ1', 'a, "b"']]);
  assert.strictEqual(csv, 'Squad,Note\r\nSQ1,"a, ""b"""');
});

test('toTSV strips tabs and newlines from values', () => {
  const tsv = App.toTSV(['Squad', 'Note'], [['SQ1', 'a\tb\nc']]);
  assert.strictEqual(tsv, 'Squad\tNote\nSQ1\ta b c');
});

test('table1ToRows and table2ToRows produce full-precision numeric rows plus totals', () => {
  const classified = [
    { sq: 'SQ1', woKey: 'C1', woLabel: 'C1', category: 'CAPEX', mh: 1 / 3 },
    { sq: 'SQ1', woKey: 'O1', woLabel: 'O1', category: 'OPEX', mh: 2 / 3 }
  ];
  const table1 = App.buildTable1(classified);
  const t1rows = App.table1ToRows(table1);
  assert.deepStrictEqual(t1rows.header, ['Squad', 'C1', 'O1', 'Total']);
  assert.strictEqual(t1rows.rows[0][1], 1 / 3);
  assert.strictEqual(t1rows.rows[1][0], 'Summary');

  const table2 = App.buildTable2(classified);
  const t2rows = App.table2ToRows(table2);
  assert.deepStrictEqual(t2rows.header, ['Squad', 'CAPEX MH', 'OPEX MH', 'CAPEX %', 'OPEX %']);
  assert.strictEqual(t2rows.rows[0][3], 1 / 3);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tests/run-tests.js`
Expected: the 5 new tests `FAIL` (`App.formatMH is not a function`, etc.), prior tests still pass.

- [ ] **Step 3: Add the formatting/export functions to `index.html`**

Edit `index.html`: replace this exact block —

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeWO, normalizeCategory, parseMappingText, rowsFromPastedText,
    parseNum, parseDataRows, classifyRows, buildTable1, buildTable2,
    CATEGORY_ORDER, CATEGORY_LABEL
  };
}
```

— with:

```javascript
function formatMH(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function formatPct(p) {
  return p == null ? '\u2013' : (Math.round(p * 1000) / 10).toFixed(1) + '%';
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(header, rows) {
  const lines = [header.map(csvEscape).join(',')];
  rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
  return lines.join('\r\n');
}

function tsvEscape(v) {
  const s = v == null ? '' : String(v);
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function toTSV(header, rows) {
  const lines = [header.map(tsvEscape).join('\t')];
  rows.forEach(r => lines.push(r.map(tsvEscape).join('\t')));
  return lines.join('\n');
}

function table1ToRows(table1) {
  const header = ['Squad', ...table1.columns.map(c => c.label), 'Total'];
  const rows = table1.squads.map(sq => [
    sq,
    ...table1.columns.map(col => table1.cellMatrix[sq][col.key] || 0),
    table1.rowTotals[sq]
  ]);
  const summary = ['Summary', ...table1.columns.map(c => table1.colTotals[c.key]), table1.grandTotal];
  rows.push(summary);
  return { header, rows };
}

function table2ToRows(table2) {
  const header = ['Squad', 'CAPEX MH', 'OPEX MH', 'CAPEX %', 'OPEX %'];
  const rows = table2.map(r => [
    r.sq,
    r.capexMH,
    r.opexMH,
    r.capexPct == null ? '' : r.capexPct,
    r.opexPct == null ? '' : r.opexPct
  ]);
  return { header, rows };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeWO, normalizeCategory, parseMappingText, rowsFromPastedText,
    parseNum, parseDataRows, classifyRows, buildTable1, buildTable2,
    CATEGORY_ORDER, CATEGORY_LABEL,
    formatMH, formatPct, toCSV, toTSV, table1ToRows, table2ToRows
  };
}
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `node tests/run-tests.js`
Expected: 14 lines of `ok - ...` and `All tests passed`. This completes the app-logic layer — it is now fully covered by tests independent of any browser.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/run-tests.js
git commit -m "feat: add MH/percent formatting and CSV/TSV export helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Static page markup and styling

**Files:**
- Modify: `index.html` (add markup + CSS, no logic)
- Create: `tests/check-structure.js`

**Interfaces:**
- Consumes: nothing (pure markup task).
- Produces: the DOM element ids that Task 5's wiring script binds to: `mapping-input`, `clear-mapping-btn`, `mapping-status`, `timesheet-input`, `xlsx-upload`, `upload-status`, `run-btn`, `banners`, `table1-container`, `copy-table1-btn`, `download-table1-btn`, `table2-container`, `copy-table2-btn`, `download-table2-btn`.

- [ ] **Step 1: Write a structural smoke test (fails until markup exists)**

```javascript
// tests/check-structure.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const requiredIds = [
  'mapping-input', 'clear-mapping-btn', 'mapping-status',
  'timesheet-input', 'xlsx-upload', 'upload-status',
  'run-btn', 'banners',
  'table1-container', 'copy-table1-btn', 'download-table1-btn',
  'table2-container', 'copy-table2-btn', 'download-table2-btn'
];

const missing = requiredIds.filter(id => !html.includes('id="' + id + '"'));

if (missing.length > 0) {
  console.log('FAIL - missing element ids: ' + missing.join(', '));
  process.exitCode = 1;
} else {
  console.log('ok - all required element ids present');
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/check-structure.js`
Expected: `FAIL - missing element ids: mapping-input, clear-mapping-btn, ...` (all 14 ids listed).

- [ ] **Step 3: Add the page markup and styling to `index.html`**

Edit `index.html`: replace this exact block (the end of the file) —

```html
</script>

</body>
</html>
```

— with:

```html
</script>

<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 1100px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; font-size: 0.85rem; padding: 8px; }
  .row { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
  button { padding: 6px 14px; cursor: pointer; }
  #run-btn { font-size: 1rem; padding: 10px 24px; margin: 16px 0; }
  .upload-btn { display: inline-block; padding: 6px 14px; border: 1px solid currentColor; border-radius: 4px; cursor: pointer; }
  .banner { padding: 10px 14px; border-radius: 4px; margin: 8px 0; font-size: 0.9rem; white-space: pre-wrap; }
  .banner.warn { background: #fff3cd; color: #664d03; border: 1px solid #ffe69c; }
  .banner.error { background: #f8d7da; color: #842029; border: 1px solid #f5c2c7; }
  .table-actions { display: flex; gap: 8px; margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; font-size: 0.85rem; }
  th, td { border: 1px solid #999; padding: 4px 8px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  tr.summary-row { font-weight: bold; background: rgba(127,127,127,0.15); }
  .table-scroll { overflow-x: auto; }
</style>

<h1>WO Timesheet Summary</h1>

<h2>1. WO Mapping</h2>
<p>วางตาราง WO No. / Category (CAPEX, OPEX, Non Charge) / WO Name (ถ้ามี) แยกด้วย Tab เช่นคัดลอกมาจาก Excel</p>
<textarea id="mapping-input" rows="8" placeholder="WO No.&#9;Category&#9;WO Name"></textarea>
<div class="row">
  <button id="clear-mapping-btn" type="button">Clear</button>
  <span id="mapping-status"></span>
</div>

<h2>2. Timesheet Input</h2>
<p>วางช่วง A2:AL13 จาก Excel หรืออัปโหลดไฟล์ .xlsx ที่มีโครงสร้างเดียวกับ krungsri.xlsx</p>
<textarea id="timesheet-input" rows="10" placeholder="Name-Surname&#9;SQ&#9;WO No.&#9;WO Name&#9;FTE/OS&#9;..."></textarea>
<div class="row">
  <label class="upload-btn">Upload .xlsx<input type="file" id="xlsx-upload" accept=".xlsx" hidden></label>
  <span id="upload-status"></span>
</div>

<div>
  <button id="run-btn" type="button">&#9654; Run</button>
</div>
<div id="banners"></div>

<h2>Table 1: Squad &times; WO (CAPEX / OPEX / Non Charge)</h2>
<div class="table-actions">
  <button id="copy-table1-btn" type="button">Copy</button>
  <button id="download-table1-btn" type="button">Download CSV</button>
</div>
<div id="table1-container" class="table-scroll"></div>

<h2>Table 2: % CAPEX / OPEX per Squad</h2>
<div class="table-actions">
  <button id="copy-table2-btn" type="button">Copy</button>
  <button id="download-table2-btn" type="button">Download CSV</button>
</div>
<div id="table2-container" class="table-scroll"></div>

<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>

</body>
</html>
```

- [ ] **Step 4: Run the structural test and the full logic test suite**

Run: `node tests/check-structure.js && node tests/run-tests.js`
Expected: `ok - all required element ids present`, followed by the 14 `ok - ...` lines and `All tests passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/check-structure.js
git commit -m "feat: add page markup, styling, and SheetJS dependency

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: DOM wiring, interactivity, and end-to-end verification

**Files:**
- Modify: `index.html` (add the wiring `<script>` block)
- Create: `tests/fixtures.js`
- Create: `tests/e2e.js`

**Interfaces:**
- Consumes: every function produced by Tasks 1–3 (`parseMappingText`, `rowsFromPastedText`, `parseDataRows`, `classifyRows`, `buildTable1`, `buildTable2`, `formatMH`, `formatPct`, `toCSV`, `toTSV`, `table1ToRows`, `table2ToRows`, `CATEGORY_LABEL`) and every element id produced by Task 4.
- Produces: a working page — no further tasks depend on this one.

- [ ] **Step 1: Create the shared sample dataset used by the e2e test**

```javascript
// tests/fixtures.js
const mappingText = [
  'WO No.\tCategory\tWO Name',
  'CAPEX-001\tCAPEX\tONE Corporate MVP1',
  'CAPEX-002\tCAPEX\tKBank Mobile Revamp',
  'OPEX-001\tOPEX\tProduction Support',
  'Z01\tNon Charge\tLeave / Day-Off',
  'Z02\tNon Charge\tTraining / Meeting'
].join('\n');

function dayRow(name, sq, woNo, woName, fte, values) {
  const days = new Array(31).fill('0');
  Object.keys(values).forEach(k => { days[Number(k) - 1] = String(values[k]); });
  return [name, sq, woNo, woName, fte, ...days].join('\t');
}

const timesheetText = [
  'Name-Surname\tSQ\tWO No.\tWO Name\tFTE/OS\t...(31 daily columns)',
  dayRow('Somchai Jaidee', 'KSB_Elephant', 'CAPEX-001', 'ONE Corporate MVP1', '1', { 1: 8, 2: 8, 3: 8 }),
  dayRow('Somsri Rakthai', 'KSB_Elephant', 'OPEX-001', 'Production Support', '1', { 1: 4, 2: 4 }),
  dayRow('Anan Chai', 'KSB_Orca', 'CAPEX-002', 'KBank Mobile Revamp', '1', { 1: 8, 2: 8, 3: 8, 4: 8 }),
  dayRow('Anan Chai', 'KSB_Orca', 'Z01', 'Leave / Day-Off', '1', { 5: 8 }),
  dayRow('Piti Suk', 'KSB_Pony', 'CAPEX-001', 'ONE Corporate MVP1', '1', { 1: 8, 2: 8 }),
  dayRow('Piti Suk', 'KSB_Pony', 'Z02', 'Training / Meeting', '1', { 3: 4 }),
  dayRow('Malee Somsri', 'KSB_Lead', 'W999-UNKNOWN', 'Some Unknown WO', '1', { 1: 8, 2: 8 })
].join('\n');

module.exports = { mappingText, timesheetText };
```

This mirrors the design's "5–8 rows covering all three categories plus one unmapped WO" test dataset: 4 squads, 2 CAPEX WOs, 1 OPEX WO, 2 Non-Charge WOs, 1 unmapped WO.

- [ ] **Step 2: Write the end-to-end pipeline test against hand-computed expected values**

```javascript
// tests/e2e.js
const assert = require('assert');
const { loadApp } = require('./load-app');
const { mappingText, timesheetText } = require('./fixtures');

const App = loadApp();

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); }
  catch (err) { failures++; console.log('  FAIL - ' + name); console.log('    ' + err.message); }
}

const mapping = App.parseMappingText(mappingText);
const rowArrays = App.rowsFromPastedText(timesheetText);
const parsed = App.parseDataRows(rowArrays);
const classified = App.classifyRows(parsed.rows, mapping);
const table1 = App.buildTable1(classified.rows);
const table2 = App.buildTable2(classified.rows);

test('sample dataset parses all 7 data rows with no skips', () => {
  assert.strictEqual(parsed.rows.length, 7);
  assert.deepStrictEqual(parsed.skippedRows, []);
});

test('sample dataset flags exactly one unmapped WO', () => {
  assert.deepStrictEqual(classified.unmappedWOs, ['W999-UNKNOWN']);
});

test('table1 has the 4 squads in first-seen order with correct totals', () => {
  assert.deepStrictEqual(table1.squads, ['KSB_Elephant', 'KSB_Orca', 'KSB_Pony', 'KSB_Lead']);
  assert.strictEqual(table1.rowTotals['KSB_Elephant'], 32);
  assert.strictEqual(table1.rowTotals['KSB_Orca'], 40);
  assert.strictEqual(table1.rowTotals['KSB_Pony'], 20);
  assert.strictEqual(table1.rowTotals['KSB_Lead'], 16);
  assert.strictEqual(table1.grandTotal, 108);
});

test('table1 columns are grouped CAPEX, OPEX, Non Charge, then Unmapped', () => {
  assert.deepStrictEqual(table1.columns.map(c => c.category),
    ['CAPEX', 'CAPEX', 'OPEX', 'NON_CHARGE', 'NON_CHARGE', 'UNMAPPED']);
});

test('table2 percentages match hand-computed values, with a dash for zero-chargeable squads', () => {
  const bySq = {};
  table2.forEach(r => { bySq[r.sq] = r; });
  assert.strictEqual(bySq['KSB_Elephant'].capexPct, 0.75);
  assert.strictEqual(bySq['KSB_Orca'].capexPct, 1);
  assert.strictEqual(bySq['KSB_Pony'].capexPct, 1);
  assert.strictEqual(App.formatPct(bySq['KSB_Lead'].capexPct), '\u2013');
});

process.on('exit', () => {
  if (failures > 0) { console.log(failures + ' failing test(s)'); process.exitCode = 1; }
  else { console.log('All e2e tests passed'); }
});
```

- [ ] **Step 3: Run it to verify it passes against the already-complete app-logic layer**

Run: `node tests/e2e.js`
Expected: 5 lines of `ok - ...` and `All e2e tests passed`. (This is the one test in the plan that is expected to pass immediately — it only exercises Tasks 1–3, which are already done. Its job is to lock in the exact expected numbers before the UI is wired up, so Step 6 has a ground truth to check the rendered page against.)

- [ ] **Step 4: Add the wiring script to `index.html`**

Edit `index.html`: replace this exact block —

```html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>

</body>
</html>
```

— with:

```html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>

<script>
(function () {
  "use strict";

  const mappingInput = document.getElementById('mapping-input');
  const clearMappingBtn = document.getElementById('clear-mapping-btn');
  const mappingStatus = document.getElementById('mapping-status');
  const timesheetInput = document.getElementById('timesheet-input');
  const xlsxUpload = document.getElementById('xlsx-upload');
  const uploadStatus = document.getElementById('upload-status');
  const runBtn = document.getElementById('run-btn');
  const banners = document.getElementById('banners');
  const table1Container = document.getElementById('table1-container');
  const table2Container = document.getElementById('table2-container');
  const copyTable1Btn = document.getElementById('copy-table1-btn');
  const downloadTable1Btn = document.getElementById('download-table1-btn');
  const copyTable2Btn = document.getElementById('copy-table2-btn');
  const downloadTable2Btn = document.getElementById('download-table2-btn');

  const MAPPING_STORAGE_KEY = 'woTimesheetSummary.mappingText';

  let lastTable1Rows = null;
  let lastTable2Rows = null;

  try {
    const saved = localStorage.getItem(MAPPING_STORAGE_KEY);
    if (saved) mappingInput.value = saved;
  } catch (e) { /* localStorage unavailable, ignore */ }

  mappingInput.addEventListener('input', () => {
    try { localStorage.setItem(MAPPING_STORAGE_KEY, mappingInput.value); } catch (e) { /* ignore */ }
  });

  clearMappingBtn.addEventListener('click', () => {
    mappingInput.value = '';
    try { localStorage.removeItem(MAPPING_STORAGE_KEY); } catch (e) { /* ignore */ }
    mappingStatus.textContent = 'Cleared';
    setTimeout(() => { mappingStatus.textContent = ''; }, 1500);
  });

  xlsxUpload.addEventListener('change', () => {
    const file = xlsxUpload.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 'A3:AJ13', blankrows: false, defval: '' });
        const header = 'Name-Surname\tSQ\tWO No.\tWO Name\tFTE/OS\t' +
          Array.from({ length: 31 }, (_, i) => 'Day' + (i + 1)).join('\t');
        const lines = [header].concat(rows.map(r => r.map(v => (v == null ? '' : v)).join('\t')));
        timesheetInput.value = lines.join('\n');
        uploadStatus.textContent = 'Loaded ' + rows.length + ' row(s) from ' + file.name;
      } catch (err) {
        uploadStatus.textContent = 'Failed to read file: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  });

  function clearBanners() { banners.innerHTML = ''; }
  function addBanner(kind, text) {
    const div = document.createElement('div');
    div.className = 'banner ' + kind;
    div.textContent = text;
    banners.appendChild(div);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderTable1(table1) {
    const groups = [];
    table1.columns.forEach(col => {
      const last = groups[groups.length - 1];
      if (last && last.category === col.category) last.span++;
      else groups.push({ category: col.category, span: 1 });
    });

    let html = '<table><thead><tr><th></th>';
    groups.forEach(g => { html += '<th colspan="' + g.span + '">' + CATEGORY_LABEL[g.category] + '</th>'; });
    html += '<th></th></tr><tr><th>Squad</th>';
    table1.columns.forEach(col => { html += '<th>' + escapeHtml(col.label) + '</th>'; });
    html += '<th>Total</th></tr></thead><tbody>';

    table1.squads.forEach(sq => {
      html += '<tr><td>' + escapeHtml(sq) + '</td>';
      table1.columns.forEach(col => {
        html += '<td>' + formatMH(table1.cellMatrix[sq][col.key] || 0) + '</td>';
      });
      html += '<td>' + formatMH(table1.rowTotals[sq]) + '</td></tr>';
    });

    html += '<tr class="summary-row"><td>Summary</td>';
    table1.columns.forEach(col => { html += '<td>' + formatMH(table1.colTotals[col.key]) + '</td>'; });
    html += '<td>' + formatMH(table1.grandTotal) + '</td></tr>';
    html += '</tbody></table>';
    table1Container.innerHTML = html;
  }

  function renderTable2(table2) {
    let html = '<table><thead><tr><th>Squad</th><th>CAPEX MH</th><th>OPEX MH</th><th>CAPEX %</th><th>OPEX %</th></tr></thead><tbody>';
    table2.forEach(r => {
      html += '<tr><td>' + escapeHtml(r.sq) + '</td><td>' + formatMH(r.capexMH) + '</td><td>' + formatMH(r.opexMH) +
        '</td><td>' + formatPct(r.capexPct) + '</td><td>' + formatPct(r.opexPct) + '</td></tr>';
    });
    html += '</tbody></table>';
    table2Container.innerHTML = html;
  }

  runBtn.addEventListener('click', () => {
    clearBanners();
    table1Container.innerHTML = '';
    table2Container.innerHTML = '';
    lastTable1Rows = null;
    lastTable2Rows = null;

    const mappingText = mappingInput.value;
    const timesheetText = timesheetInput.value;

    if (!mappingText.trim()) {
      addBanner('error', 'กรุณาวางตาราง WO Mapping ก่อนกด Run');
      return;
    }
    if (!timesheetText.trim()) {
      addBanner('error', 'กรุณาวางข้อมูล Timesheet ก่อนกด Run');
      return;
    }

    const mapping = parseMappingText(mappingText);
    const rowArrays = rowsFromPastedText(timesheetText);
    const parsed = parseDataRows(rowArrays);

    if (parsed.rows.length === 0) {
      addBanner('error', 'ไม่พบแถวข้อมูลที่ใช้ได้ใน Timesheet Input');
      return;
    }
    if (parsed.skippedRows.length > 0) {
      addBanner('warn', 'ข้ามแถวที่อ่านไม่ได้ (แถวที่ ' + parsed.skippedRows.join(', ') + ' ในข้อมูลที่วาง)');
    }

    const classified = classifyRows(parsed.rows, mapping);
    if (classified.unmappedWOs.length > 0) {
      addBanner('warn', 'พบ WO No. ที่ไม่มีในตาราง Mapping: ' + classified.unmappedWOs.join(', '));
    }

    const table1 = buildTable1(classified.rows);
    const table2 = buildTable2(classified.rows);

    renderTable1(table1);
    renderTable2(table2);

    lastTable1Rows = table1ToRows(table1);
    lastTable2Rows = table2ToRows(table2);
  });

  function flashButton(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1500);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      addBanner('error', 'Copy ไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง');
    }
    document.body.removeChild(ta);
  }

  function copyRows(rows, btn) {
    if (!rows) { addBanner('error', 'กรุณากด Run ก่อน Copy'); return; }
    const tsv = toTSV(rows.header, rows.rows);
    const done = () => flashButton(btn, '\u2713 Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(done).catch(() => fallbackCopy(tsv, done));
    } else {
      fallbackCopy(tsv, done);
    }
  }

  function downloadRows(rows, filenamePrefix) {
    if (!rows) { addBanner('error', 'กรุณากด Run ก่อน Download'); return; }
    const csv = toCSV(rows.header, rows.rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = filenamePrefix + '_' + date + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  copyTable1Btn.addEventListener('click', () => copyRows(lastTable1Rows, copyTable1Btn));
  copyTable2Btn.addEventListener('click', () => copyRows(lastTable2Rows, copyTable2Btn));
  downloadTable1Btn.addEventListener('click', () => downloadRows(lastTable1Rows, 'wo-summary'));
  downloadTable2Btn.addEventListener('click', () => downloadRows(lastTable2Rows, 'wo-percent'));
})();
</script>

</body>
</html>
```

- [ ] **Step 5: Re-run the full automated suite**

Run: `node tests/check-structure.js && node tests/run-tests.js && node tests/e2e.js`
Expected: all three report success (`ok - all required element ids present`, `All tests passed`, `All e2e tests passed`). This confirms the markup, the logic, and the exact numbers the UI is about to render are all still consistent after adding the wiring script.

- [ ] **Step 6: Manual browser verification**

The wiring script uses `navigator.clipboard`, `FileReader`, and a real file-download flow — none of which a Node script can exercise. Verify by hand:

1. Open the file directly in a browser: on Windows, `start index.html` (or double-click it in Explorer).
2. Paste this into the **WO Mapping** box:
   ```
   WO No.	Category	WO Name
   CAPEX-001	CAPEX	ONE Corporate MVP1
   CAPEX-002	CAPEX	KBank Mobile Revamp
   OPEX-001	OPEX	Production Support
   Z01	Non Charge	Leave / Day-Off
   Z02	Non Charge	Training / Meeting
   ```
3. Paste this into the **Timesheet Input** box (this is the same fixture as `tests/fixtures.js`, laid out as real tab-separated columns — Name, SQ, WO No., WO Name, FTE/OS, then day1..day31):
   ```
   Name-Surname	SQ	WO No.	WO Name	FTE/OS	Day1	Day2	Day3	Day4	Day5
   Somchai Jaidee	KSB_Elephant	CAPEX-001	ONE Corporate MVP1	1	8	8	8	0	0
   Somsri Rakthai	KSB_Elephant	OPEX-001	Production Support	1	4	4	0	0	0
   Anan Chai	KSB_Orca	CAPEX-002	KBank Mobile Revamp	1	8	8	8	8	0
   Anan Chai	KSB_Orca	Z01	Leave / Day-Off	1	0	0	0	0	8
   Piti Suk	KSB_Pony	CAPEX-001	ONE Corporate MVP1	1	8	8	0	0	0
   Piti Suk	KSB_Pony	Z02	Training / Meeting	1	0	0	4	0	0
   Malee Somsri	KSB_Lead	W999-UNKNOWN	Some Unknown WO	1	8	8	0	0	0
   ```
4. Click **▶ Run**. Confirm:
   - A yellow warning banner appears naming `W999-UNKNOWN` as unmapped.
   - Table 1 shows 4 squad rows + a bold `Summary` row; `KSB_Elephant` total = `32.00`, `KSB_Orca` = `40.00`, `KSB_Pony` = `20.00`, `KSB_Lead` = `16.00`, grand total `108.00` — matching Step 3's e2e assertions.
   - Table 2 shows `KSB_Elephant` at `75.0%` CAPEX / `25.0%` OPEX, `KSB_Orca` and `KSB_Pony` at `100.0%` CAPEX, and `KSB_Lead` showing `–` for both percentages.
5. Click **Copy** under Table 1, then paste into a scratch Excel sheet — confirm it lands as one WO per column, one squad per row.
6. Click **Download CSV** under Table 1 — confirm a `wo-summary_YYYY-MM-DD.csv` file downloads and opens correctly in Excel (no mangled characters, `%` signs display properly in Table 2's CSV).
7. Try the **Upload .xlsx** button with the original `krungsri.xlsx` (still empty of data) — confirm it populates the Timesheet Input box without throwing an error (an empty result is expected since that file has no input rows yet).
8. Reload the page — confirm the WO Mapping box still has the pasted content (localStorage persistence).

If any check fails, fix the wiring script and re-run Steps 5–6 before committing.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/fixtures.js tests/e2e.js
git commit -m "feat: wire up UI interactivity, xlsx upload, copy/export, and e2e test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** WO Mapping textarea + persistence (Task 5), Timesheet paste + `.xlsx` upload (Task 4 markup / Task 5 wiring), dynamic Squad×WO cross-tab with CAPEX→OPEX→NonCharge→Unmapped column grouping (Task 2/5), %CAPEX/%OPEX table with `–` for zero-chargeable squads (Task 2/5), Copy-to-clipboard as TSV and Download as UTF-8-BOM CSV (Task 3/5), unmapped-WO warning banner (Task 5), skipped-row warning banner (Task 5), full-precision export vs. rounded display (Task 3) — all covered. `Remaining (JUL/AUG)` rows are explicitly out of scope per the design doc.
- **Type/name consistency checked:** `formatMH`, `formatPct`, `toCSV`, `toTSV`, `table1ToRows`, `table2ToRows`, `CATEGORY_LABEL`, and all element ids are spelled identically between the app-logic block (Tasks 1–3), the markup (Task 4), and the wiring script (Task 5).
