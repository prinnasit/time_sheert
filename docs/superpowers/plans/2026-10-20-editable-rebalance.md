# Editable Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ user แก้คำแนะนำ Rebalance ได้ระดับวันก่อน Apply และแก้ Timesheet ต่อหลัง Apply โดยตาราง สีของช่อง และประวัติอัปเดตเอง

**Architecture:** ฟังก์ชันล้วนใหม่ 4 ตัวในส่วน logic ของ `index.html` (`diffTimesheets`, `movesToDraft`, `draftRowDefaults`, `resolveDraft` และ helper `cellKey` / `cellTotals`) มี unit test ใน Node ครบ ส่วน UI (IIFE ตัวที่สองใน `index.html`) แยก handler ของปุ่ม Run ออกมาเป็น `refresh({ replan })` แล้วเพิ่มการคำนวณใหม่อัตโนมัติหลัง Apply การระบายสีช่อง และตารางร่าง (`rebalanceDraft`) ที่มาแทนตารางคำแนะนำเดิม

**Tech Stack:** HTML/JS ไฟล์เดียว (ไม่มี build), Node `assert` สำหรับ unit test, Python Playwright สำหรับ browser test

**Spec:** [docs/superpowers/specs/2026-10-20-editable-rebalance-design.md](../specs/2026-10-20-editable-rebalance-design.md)

## Global Constraints

- ทั้งแอปอยู่ใน `index.html` ไฟล์เดียว: logic อยู่ใน `<script id="app-logic">` (ฟังก์ชันล้วน export ผ่าน `module.exports`) ส่วน UI อยู่ใน IIFE ของ `<script>` ตัวที่สอง UI เรียกฟังก์ชันของ logic ได้ตรง ๆ เพราะเป็น global
- ข้อความบนหน้าเว็บเป็นภาษาไทย ชื่อในโค้ดและ comment เป็นภาษาอังกฤษ เขียนให้เหมือนโค้ดรอบข้าง
- คำสั่ง test: `node tests/all.js` (ต้องขึ้น `ALL TEST FILES PASSED`) และ `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py` (ต้องขึ้น `all N browser tests passed`) browser test ต้องต่อเน็ต เพราะโหลด SheetJS จาก CDN
- browser test helper ที่มีอยู่แล้วใน `tests/browser_e2e.py`: `setup`, `setup_over_80`, `grid_cell`, `day_col`, `opex_cell`, `table2_row`, `summary_row`, `paste_mapping`, `timesheet_row`, `MAPPING`, `OVER_80`, `NEEDS_ROUND_2`, `DEV1` test ใหม่ต้องเพิ่มลงลิสต์ `TESTS` ท้ายไฟล์ด้วยเสมอ
- Node test helper ที่มีอยู่แล้วใน `tests/rebalance.js`: `row(name, sq, wo, dayValues)`, `days(from, to, v)`, `mapping` (C1, C2, C3 = CAPEX · O1 = OPEX · Z01 = Non Charge), `ctxFor(rows, people, extra)` (workingDays 20), `DEV(name)` test ใหม่วางก่อนบรรทัด `process.on('exit', ...)` ท้ายไฟล์
- commit message ต้องจบด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- ห้าม `git push` จนกว่า user จะบอกให้ push (GitHub Pages deploy จาก `master` ทันทีที่ push)
- ห้ามแก้ `planRebalance` กับ `applyMoves`

---

### Task 1: `cellKey`, `cellTotals`, `diffTimesheets` (logic + Node test)

**Files:**
- Modify: `index.html` วางฟังก์ชันใหม่ใน `<script id="app-logic">` ต่อจาก `function squadSummary(...) { ... }` และเพิ่มชื่อในบรรทัด export `takeTimesheetRows, timesheetToAoa, timesheetToTSV, squadSummary, diffCell,`
- Test: `tests/rebalance.js`

**Interfaces:**
- Produces:
  - `cellKey(nameKey: string, sq: string, woKey: string): string` คืน `nameKey|sq|woKey`
  - `cellTotals(rowArrays): { totals: {[key]: number[31]}, order: string[], labels: {[key]: {name, sq, woNo}} }` แถวที่ key ซ้ำกันจะถูกรวมค่า ส่วน `sq` ว่างจะเป็น `'(Unspecified)'` เหมือน `extractEntries`
  - `diffTimesheets(original, current, appliedMoves): { header: string[7], rows: [name, sq, woNo, day(number), before(number|''), after(number|''), 'Rebalance'|'แก้เอง'][] }` move ต้องมี `nameKey, sq, fromWoKey, toWoKey, day, mh`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** วางก่อน `process.on('exit'` ใน `tests/rebalance.js`

```js
// ---- diffTimesheets ----------------------------------------------------------
const dfOriginal = () => [row('Dev1', 'S1', 'C1', { 1: 8 }), row('Dev1', 'S1', 'O1', { 10: 8, 11: 8 })];
const dfMoves = [{ nameKey: 'dev1', sq: 'S1', fromWoKey: 'O1', toWoKey: 'C1', day: 11, mh: 2 }];

test('cellTotals sums rows that share name/squad/WO and keeps first-seen order', () => {
  const t = App.cellTotals([row('Dev1', 'S1', 'O1', { 1: 4 }), row('Dev1', 'S1', 'C1', { 1: 1 }), row(' dev1 ', 'S1', 'o1', { 1: 2 })]);
  assert.deepStrictEqual(t.order, [App.cellKey('dev1', 'S1', 'O1'), App.cellKey('dev1', 'S1', 'C1')]);
  assert.strictEqual(t.totals[App.cellKey('dev1', 'S1', 'O1')][0], 6);
  assert.deepStrictEqual(t.labels[App.cellKey('dev1', 'S1', 'O1')], { name: 'Dev1', sq: 'S1', woNo: 'O1' });
});

test('diffTimesheets: an unchanged timesheet has no rows', () => {
  const d = App.diffTimesheets(dfOriginal(), dfOriginal(), []);
  assert.deepStrictEqual(d.header, ['Name-Surname', 'Squad', 'WO No.', 'Day', 'เดิม', 'ใหม่', 'แก้โดย']);
  assert.deepStrictEqual(d.rows, []);
});

test('diffTimesheets labels cells matching the applied moves as Rebalance and the rest as แก้เอง', () => {
  const current = [row('Dev1', 'S1', 'C1', { 1: 8, 10: 1, 11: 2 }), row('Dev1', 'S1', 'O1', { 10: 7, 11: 6 })];
  assert.deepStrictEqual(App.diffTimesheets(dfOriginal(), current, dfMoves).rows, [
    ['Dev1', 'S1', 'C1', 10, '', 1, 'แก้เอง'],
    ['Dev1', 'S1', 'C1', 11, '', 2, 'Rebalance'],
    ['Dev1', 'S1', 'O1', 10, 8, 7, 'แก้เอง'],
    ['Dev1', 'S1', 'O1', 11, 8, 6, 'Rebalance']
  ]);
});

test('diffTimesheets: typing over a Rebalance cell makes it แก้เอง, typing it back removes it', () => {
  const over = [row('Dev1', 'S1', 'C1', { 1: 8, 11: 2 }), row('Dev1', 'S1', 'O1', { 10: 8, 11: 5 })];
  assert.deepStrictEqual(App.diffTimesheets(dfOriginal(), over, dfMoves).rows[1], ['Dev1', 'S1', 'O1', 11, 8, 5, 'แก้เอง']);
  assert.deepStrictEqual(App.diffTimesheets(dfOriginal(), dfOriginal(), dfMoves).rows, []);
});

test('diffTimesheets: a row Rebalance created shows เดิม blank, and row order does not matter', () => {
  const moves = [{ nameKey: 'dev1', sq: 'S1', fromWoKey: 'O1', toWoKey: 'C2', day: 11, mh: 2 }];
  const current = [row('Dev1', 'S1', 'C2', { 11: 2 }), row('Dev1', 'S1', 'O1', { 10: 8, 11: 6 }), row('Dev1', 'S1', 'C1', { 1: 8 })];
  assert.deepStrictEqual(App.diffTimesheets(dfOriginal(), current, moves).rows, [
    ['Dev1', 'S1', 'C2', 11, '', 2, 'Rebalance'],
    ['Dev1', 'S1', 'O1', 11, 8, 6, 'Rebalance']
  ]);
});

test('diffTimesheets: a deleted row shows ใหม่ blank as แก้เอง', () => {
  const current = [row('Dev1', 'S1', 'O1', { 10: 8, 11: 8 })];
  assert.deepStrictEqual(App.diffTimesheets(dfOriginal(), current, []).rows, [['Dev1', 'S1', 'C1', 1, 8, '', 'แก้เอง']]);
});
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `node tests/rebalance.js`
Expected: 6 บรรทัด `FAIL - ...` เช่น `App.cellTotals is not a function`

- [ ] **Step 3: เขียนโค้ด** วางต่อจาก `function squadSummary` ใน `index.html`

```js
// Key for one timesheet cell column: the same person, squad and WO, so
// rows can be compared across versions no matter how they are ordered.
function cellKey(nameKey, sq, woKey) {
  return nameKey + '|' + sq + '|' + woKey;
}

// Per cellKey, the 31 daily MH (rows sharing a key are summed), the order
// keys first appear in, and a label (as written in the first such row).
function cellTotals(rowArrays) {
  const totals = {}, order = [], labels = {};
  extractEntries(rowArrays, { map: {} }).forEach(e => {
    const k = cellKey(e.nameKey, e.sq, e.woKey);
    if (!totals[k]) {
      totals[k] = new Array(31).fill(0);
      order.push(k);
      labels[k] = { name: e.name, sq: e.sq, woNo: e.woNo };
    }
    e.days.forEach((v, i) => { totals[k][i] += v; });
  });
  return { totals: totals, order: order, labels: labels };
}

// Every day cell that differs between the original and current timesheet.
// "Rebalance" when the current value is exactly what the applied moves
// produce from the original, "แก้เอง" (typed by hand) otherwise.
function diffTimesheets(original, current, appliedMoves) {
  const round = v => Math.round(v * 1e6) / 1e6;
  const blank = v => (round(v) === 0 ? '' : round(v));
  const before = cellTotals(original), after = cellTotals(current);
  const expected = {};
  Object.keys(before.totals).forEach(k => { expected[k] = before.totals[k].slice(); });
  const bump = (k, day, mh) => { (expected[k] = expected[k] || new Array(31).fill(0))[day - 1] += mh; };
  (appliedMoves || []).forEach(m => {
    bump(cellKey(m.nameKey, m.sq, m.fromWoKey), m.day, -m.mh);
    bump(cellKey(m.nameKey, m.sq, m.toWoKey), m.day, m.mh);
  });
  const zero = new Array(31).fill(0);
  const keys = after.order.concat(before.order.filter(k => after.order.indexOf(k) < 0));
  const rows = [];
  keys.forEach(k => {
    const b = before.totals[k] || zero, a = after.totals[k] || zero, x = expected[k] || zero;
    const label = after.labels[k] || before.labels[k];
    for (let i = 0; i < 31; i++) {
      if (round(b[i]) === round(a[i])) continue;
      rows.push([label.name, label.sq, label.woNo, i + 1, blank(b[i]), blank(a[i]), round(a[i]) === round(x[i]) ? 'Rebalance' : 'แก้เอง']);
    }
  });
  return { header: ['Name-Surname', 'Squad', 'WO No.', 'Day', 'เดิม', 'ใหม่', 'แก้โดย'], rows: rows };
}
```

แล้วแก้บรรทัด export ใน `module.exports`:

```js
    takeTimesheetRows, timesheetToAoa, timesheetToTSV, squadSummary, cellKey, cellTotals, diffTimesheets, diffCell,
```

- [ ] **Step 4: รัน test ต้องผ่าน**

Run: `node tests/all.js`
Expected: `ALL TEST FILES PASSED`

- [ ] **Step 5: Commit**

```bash
git add index.html tests/rebalance.js
git commit -m "feat: add diffTimesheets (cell-level original vs current, Rebalance vs แก้เอง)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `movesToDraft`, `draftRowDefaults` (logic + Node test)

**Files:**
- Modify: `index.html` วางต่อจาก `function diffTimesheets` และเพิ่มชื่อในบรรทัด export
- Test: `tests/rebalance.js`

**Interfaces:**
- Consumes: `extractEntries(rowArrays, mapping)` (มีอยู่แล้ว) คืน entries ที่มี `index, name, nameKey, sq, woNo, woKey, category, days[31]`
- Produces:
  - `movesToDraft(moves): DraftRow[]` โดย `DraftRow = { nameKey, name, sq, day, mh, fromWoKey, toWoKey, origin: 'plan' }` ยังไม่มี `id` เพราะ UI จะใส่ให้
  - `draftRowDefaults(rows, mapping, nameKey, sq): { fromWoKey, toWoKey, day, mh: 1 }`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** วางก่อน `process.on('exit'`

```js
// ---- movesToDraft / draftRowDefaults ----------------------------------------
test('movesToDraft merges the planner\'s 1-MH moves into one row per person/day/WO pair', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8, 2: 8 }), row('Dev1', 'S1', 'O1', days(3, 11, 8))];
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1')]));
  assert.deepStrictEqual(App.movesToDraft(plan.moves), [
    { nameKey: 'dev1', name: 'Dev1', sq: 'S1', day: 11, mh: 2, fromWoKey: 'O1', toWoKey: 'C1', origin: 'plan' }
  ]);
});

test('movesToDraft keeps first-seen order across days', () => {
  const m = (day, mh) => ({ nameKey: 'a', name: 'A', sq: 'S', day: day, mh: mh, fromWoKey: 'O1', toWoKey: 'C1' });
  const draft = App.movesToDraft([m(4, 1), m(3, 0.5), m(4, 1)]);
  assert.deepStrictEqual(draft.map(d => [d.day, d.mh]), [[4, 2], [3, 0.5]]);
});

test('draftRowDefaults: biggest OPEX WO, own CAPEX WO, latest day with hours, 1 MH', () => {
  const rows = [row('Ann', 'S1', 'C2', { 1: 8 }), row('Ann', 'S1', 'O1', { 20: 8, 22: 4 }), row('Ann', 'S1', 'Z01', { 23: 8 })];
  assert.deepStrictEqual(App.draftRowDefaults(rows, mapping, 'ann', 'S1'), { fromWoKey: 'O1', toWoKey: 'C2', day: 22, mh: 1 });
});

test('draftRowDefaults without OPEX takes the first WO and a different CAPEX WO', () => {
  const rows = [row('Bob', 'S1', 'C1', { 1: 8 })];
  assert.deepStrictEqual(App.draftRowDefaults(rows, mapping, 'bob', 'S1'), { fromWoKey: 'C1', toWoKey: 'C2', day: 1, mh: 1 });
  assert.deepStrictEqual(App.draftRowDefaults([], mapping, 'nobody', 'S1'), { fromWoKey: '', toWoKey: 'C1', day: 1, mh: 1 });
});
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `node tests/rebalance.js`
Expected: 4 บรรทัด `FAIL` (`App.movesToDraft is not a function` / `App.draftRowDefaults is not a function`)

- [ ] **Step 3: เขียนโค้ด** วางต่อจาก `function diffTimesheets`

```js
// Planner moves (1 MH each) -> editable draft rows, one per person / day /
// from-WO / to-WO, in first-seen order. The UI adds the `id`.
function movesToDraft(moves) {
  const out = [], byKey = {};
  moves.forEach(m => {
    const k = [m.nameKey, m.sq, m.day, m.fromWoKey, m.toWoKey].join('|');
    if (!byKey[k]) {
      byKey[k] = { nameKey: m.nameKey, name: m.name, sq: m.sq, day: m.day, mh: 0, fromWoKey: m.fromWoKey, toWoKey: m.toWoKey, origin: 'plan' };
      out.push(byKey[k]);
    }
    byKey[k].mh = Math.round((byKey[k].mh + m.mh) * 1e6) / 1e6;
  });
  return out;
}

// Starting values for a draft row the user adds (or re-points at another
// person): from their biggest OPEX WO (else their first WO), to a CAPEX WO
// that isn't the source (their own first, else the mapping's), on the
// latest day the source has hours, 1 MH.
function draftRowDefaults(rows, mapping, nameKey, sq) {
  const sumDays = e => e.days.reduce((a, b) => a + b, 0);
  const mine = extractEntries(rows, mapping).filter(e => e.nameKey === nameKey && e.sq === sq);
  const opex = mine.filter(e => e.category === 'OPEX').sort((a, b) => sumDays(b) - sumDays(a));
  const from = opex[0] || mine[0] || null;
  const fromWoKey = from ? from.woKey : '';
  const allCapex = Object.keys(mapping.map).filter(k => mapping.map[k].category === 'CAPEX');
  const own = mine.filter(e => e.category === 'CAPEX').map(e => e.woKey);
  const toWoKey = own.concat(allCapex).filter(k => k !== fromWoKey)[0] || '';
  let day = 1;
  if (from) for (let d = 31; d >= 1; d--) { if (from.days[d - 1] > 0) { day = d; break; } }
  return { fromWoKey: fromWoKey, toWoKey: toWoKey, day: day, mh: 1 };
}
```

แก้บรรทัด export:

```js
    takeTimesheetRows, timesheetToAoa, timesheetToTSV, squadSummary, cellKey, cellTotals, diffTimesheets,
    movesToDraft, draftRowDefaults, diffCell,
```

- [ ] **Step 4: รัน test ต้องผ่าน**

Run: `node tests/all.js`
Expected: `ALL TEST FILES PASSED`

- [ ] **Step 5: Commit**

```bash
git add index.html tests/rebalance.js
git commit -m "feat: add movesToDraft and draftRowDefaults for the editable rebalance draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `resolveDraft` (logic + Node test) + ปรับถ้อยคำใน spec

**Files:**
- Modify: `index.html` วางต่อจาก `function draftRowDefaults` และเพิ่มชื่อในบรรทัด export
- Modify: `docs/superpowers/specs/2026-10-20-editable-rebalance-design.md` หัวข้อ "การ validate"
- Test: `tests/rebalance.js`

**Interfaces:**
- Consumes: `extractEntries`, `applyMoves`, `normalizeKey`, `BASE_MONTH_MD`, `MH_PER_DAY` (มีอยู่แล้ว), `DraftRow` + `id` จาก Task 2
- Produces: `resolveDraft(rows, draft, ctx): { moves: Move[], errors: {[id]: string}, warnings: {[id]: string[]}, previewRows }`
  - `ctx` = `{ mapping, roleMap, ceilings, workingDays, remainingLast }` ซึ่งคือผลของ `buildRebalanceCtx` ใน UI
  - `Move` ใช้ field เดียวกับ move ของ `planRebalance` โดยมี `round: 0` และ `toRow: null` เมื่อคนนั้นยังไม่มีแถวของ WO ปลายทาง

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** วางก่อน `process.on('exit'`

```js
// ---- resolveDraft -------------------------------------------------------------
const rdRows = () => [row('Dev1', 'S1', 'C1', { 1: 8, 2: 8 }), row('Dev1', 'S1', 'O1', days(3, 11, 8))];
const rdRow = o => Object.assign({ id: 1, nameKey: 'dev1', name: 'Dev1', sq: 'S1', day: 11, mh: 2, fromWoKey: 'O1', toWoKey: 'C1', origin: 'plan' }, o);
const rdCtx = (people, extra) => ctxFor(rdRows(), people === undefined ? [DEV('Dev1')] : people, extra);

test('resolveDraft turns a valid row into one move and previews it', () => {
  const r = App.resolveDraft(rdRows(), [rdRow()], rdCtx());
  assert.deepStrictEqual(r.errors, {});
  assert.deepStrictEqual(r.warnings, {});
  assert.strictEqual(r.moves.length, 1);
  const m = r.moves[0];
  assert.deepStrictEqual([m.fromRow, m.toRow, m.day, m.mh, m.round, m.fromWoKey, m.toWoKey], [1, 0, 11, 2, 0, 'O1', 'C1']);
  assert.strictEqual(r.previewRows[1][5 + 10], '6');
  assert.strictEqual(r.previewRows[0][5 + 10], '2');
});

test('resolveDraft with an empty draft changes nothing', () => {
  const r = App.resolveDraft(rdRows(), [], rdCtx());
  assert.deepStrictEqual([r.moves, r.errors, r.warnings], [[], {}, {}]);
  assert.deepStrictEqual(r.previewRows, rdRows());
});

test('resolveDraft reports one error per bad row and leaves it out of the moves', () => {
  const cases = [
    [{ mh: 0 }, 'MH ต้องมากกว่า 0'],
    [{ mh: 'abc' }, 'MH ต้องมากกว่า 0'],
    [{ day: 0 }, 'วันต้องเป็น 1–31'],
    [{ toWoKey: 'O1' }, 'จาก WO กับไป WO ต้องไม่ใช่ตัวเดียวกัน'],
    [{ toWoKey: 'Z01' }, 'ไป WO ต้องเป็น CAPEX'],
    [{ fromWoKey: 'O9' }, 'ไม่พบแถว O9 ของ Dev1'],
    [{ mh: 9 }, 'วันที่ 11 ของ O1 เหลือให้ย้ายได้ 8 MH']
  ];
  cases.forEach(([o, msg]) => {
    const r = App.resolveDraft(rdRows(), [rdRow(o)], rdCtx());
    assert.deepStrictEqual(r.errors, { 1: msg }, JSON.stringify(o));
    assert.strictEqual(r.moves.length, 0);
  });
});

test('resolveDraft counts earlier rows that draw on the same cell', () => {
  const r = App.resolveDraft(rdRows(), [rdRow({ id: 1, mh: 5 }), rdRow({ id: 2, mh: 5 })], rdCtx());
  assert.deepStrictEqual(r.errors, { 2: 'วันที่ 11 ของ O1 เหลือให้ย้ายได้ 3 MH' });
  assert.strictEqual(r.moves.length, 1);
});

test('resolveDraft targets a CAPEX WO the person has no row for with toRow null (applyMoves adds it)', () => {
  const r = App.resolveDraft(rdRows(), [rdRow({ toWoKey: 'C2' })], rdCtx());
  assert.strictEqual(r.moves[0].toRow, null);
  assert.strictEqual(r.previewRows.length, 3);
  assert.deepStrictEqual(r.previewRows[2].slice(0, 4), ['Dev1', 'S1', 'C2', 'Cap 2']);
  assert.strictEqual(r.previewRows[2][5 + 10], '2');
});

test('resolveDraft warns (but still moves) when CAPEX would pass the role ceiling', () => {
  const r = App.resolveDraft(rdRows(), [rdRow()], rdCtx(undefined, { workingDays: 1 })); // ceiling 16 MD x 1/20 = 0.8 MD
  assert.deepStrictEqual(r.warnings, { 1: ['CAPEX ของ Dev1 จะเป็น 2.25 MD เกินเพดาน 0.8 MD'] });
  assert.strictEqual(r.moves.length, 1);
  assert.deepStrictEqual(App.resolveDraft(rdRows(), [rdRow()], rdCtx([], { workingDays: 1 })).warnings, {}); // no role, no ceiling check
});

test('resolveDraft warns when the target WO\'s Remaining would go negative', () => {
  const r = App.resolveDraft(rdRows(), [rdRow()], rdCtx(undefined, { remainingLast: { C1: 2 } })); // 18 MH = 2.25 MD used
  assert.deepStrictEqual(r.warnings, { 1: ['Remaining ของ C1 จะติดลบ 0.25 MD'] });
});
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `node tests/rebalance.js`
Expected: 7 บรรทัด `FAIL` (`App.resolveDraft is not a function`)

- [ ] **Step 3: เขียนโค้ด** วางต่อจาก `function draftRowDefaults`

```js
// Draft rows -> moves applyMoves() can run, checked against the current
// timesheet. A row with an error is left out (and blocks Apply in the UI);
// warnings (CAPEX over the role ceiling, Remaining going negative) don't.
// The source cell is the person's row for fromWoKey with the most hours on
// that day; rows earlier in the draft that draw on the same cell count.
function resolveDraft(rows, draft, ctx) {
  const fmt = v => String(Math.round(v * 100) / 100);
  const sumDays = e => e.days.reduce((a, b) => a + b, 0);
  const entries = extractEntries(rows, ctx.mapping);
  const errors = {}, warnings = {}, moves = [], okRows = [], taken = {};

  draft.forEach(d => {
    const mh = Number(d.mh), day = Number(d.day);
    const to = ctx.mapping.map[d.toWoKey];
    const mine = entries.filter(e => e.nameKey === d.nameKey && e.sq === d.sq);
    let err = null, src = null;
    if (!(mh > 0)) err = 'MH ต้องมากกว่า 0';
    else if (!(Number.isInteger(day) && day >= 1 && day <= 31)) err = 'วันต้องเป็น 1–31';
    else if (d.fromWoKey === d.toWoKey) err = 'จาก WO กับไป WO ต้องไม่ใช่ตัวเดียวกัน';
    else if (!to || to.category !== 'CAPEX') err = 'ไป WO ต้องเป็น CAPEX';
    else {
      src = mine.filter(e => e.woKey === d.fromWoKey).sort((a, b) => b.days[day - 1] - a.days[day - 1])[0] || null;
      if (!src) err = 'ไม่พบแถว ' + d.fromWoKey + ' ของ ' + d.name;
      else {
        const k = src.index + '|' + day;
        const left = src.days[day - 1] - (taken[k] || 0);
        if (mh > left + 1e-9) err = 'วันที่ ' + day + ' ของ ' + src.woNo + ' เหลือให้ย้ายได้ ' + fmt(Math.max(left, 0)) + ' MH';
        else taken[k] = (taken[k] || 0) + mh;
      }
    }
    if (err) { errors[d.id] = err; return; }
    const tgt = mine.find(e => e.woKey === d.toWoKey);
    moves.push({
      nameKey: d.nameKey, name: src.name, sq: d.sq, fte: src.fte, round: 0,
      fromRow: src.index, fromWoNo: src.woNo, fromWoKey: src.woKey,
      toRow: tgt ? tgt.index : null, toWoNo: to.wo, toWoKey: d.toWoKey, toWoName: to.name || to.wo,
      day: day, mh: mh
    });
    okRows.push(d);
  });

  const previewRows = applyMoves(rows, moves);
  const preview = extractEntries(previewRows, ctx.mapping);
  const scale = ctx.workingDays / BASE_MONTH_MD;
  okRows.forEach(d => {
    const list = [];
    const role = ctx.roleMap[d.nameKey];
    const c = role ? ctx.ceilings[normalizeKey(role)] : null;
    if (c) {
      const capexMH = preview.filter(e => e.nameKey === d.nameKey && e.category === 'CAPEX').reduce((a, e) => a + sumDays(e), 0);
      const limit = c.capex * scale * MH_PER_DAY;
      if (capexMH > limit + 1e-9) {
        list.push('CAPEX ของ ' + d.name + ' จะเป็น ' + fmt(capexMH / MH_PER_DAY) + ' MD เกินเพดาน ' + fmt(limit / MH_PER_DAY) + ' MD');
      }
    }
    const last = (ctx.remainingLast || {})[d.toWoKey];
    if (last != null) {
      const usedMD = preview.filter(e => e.woKey === d.toWoKey).reduce((a, e) => a + sumDays(e), 0) / MH_PER_DAY;
      if (last - usedMD < -1e-9) list.push('Remaining ของ ' + ctx.mapping.map[d.toWoKey].wo + ' จะติดลบ ' + fmt(usedMD - last) + ' MD');
    }
    if (list.length) warnings[d.id] = list;
  });

  return { moves: moves, errors: errors, warnings: warnings, previewRows: previewRows };
}
```

แก้บรรทัด export:

```js
    movesToDraft, draftRowDefaults, resolveDraft, diffCell,
```

- [ ] **Step 4: รัน test ต้องผ่าน**

Run: `node tests/all.js`
Expected: `ALL TEST FILES PASSED`

- [ ] **Step 5: ปรับ spec ให้ตรงกับโค้ด** ใน `docs/superpowers/specs/2026-10-20-editable-rebalance-design.md` หัวข้อ "**Error (แถวนั้นไม่ถูกนำไปใช้ และปุ่ม Apply ถูกปิด)**" ให้แทนรายการ 1–5 เดิมด้วย:

```markdown
1. `mh` ไม่ใช่ตัวเลข > 0 → `MH ต้องมากกว่า 0`
2. `day` ไม่ใช่จำนวนเต็ม 1–31 → `วันต้องเป็น 1–31`
3. `fromWoKey === toWoKey` → `จาก WO กับไป WO ต้องไม่ใช่ตัวเดียวกัน`
4. `toWoKey` ไม่ใช่ CAPEX ใน Mapping → `ไป WO ต้องเป็น CAPEX`
5. ไม่เจอแถวของคนนั้น (nameKey + sq) ที่มี WO = `fromWoKey` → `ไม่พบแถว <WO> ของ <ชื่อ>`
6. `mh` มากกว่าที่เหลือในช่องต้นทาง → `วันที่ <d> ของ <WO> เหลือให้ย้ายได้ <x> MH` (ช่องต้นทาง = แถวของคนนั้นที่มี WO นี้และมีชั่วโมงในวันนั้นมากที่สุด ที่เหลือ = ค่าในช่องนั้น ลบ MH ที่แถวร่างก่อนหน้าดึงจากช่องเดียวกันไปแล้ว)
```

และแก้คำว่า "error ทั้ง 5 แบบ" ในหัวข้อ "ส่วนที่ 4: การ test" เป็น "error ทั้ง 6 แบบ"

- [ ] **Step 6: Commit**

```bash
git add index.html tests/rebalance.js docs/superpowers/specs/2026-10-20-editable-rebalance-design.md
git commit -m "feat: add resolveDraft (validate draft rows, build moves, ceiling/Remaining warnings)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: หลัง Apply: `refresh({ replan })`, คำนวณใหม่อัตโนมัติ, ระบายสีช่อง, ประวัติแบบ diff

**Files:**
- Modify: `index.html` ส่วน UI ได้แก่ handler ของ `runBtn`, `createGridEditor(timesheetGridMount, ...)`, `applyRebalance`, `undoRebalance`, `renderChangeLog`, `buildChangeLogClipboardHTML`, startup block `if (rebalanceState) { try { renderRebalance(); renderChangeLog(); } ... }` และ CSS ใน `<style>`
- Modify: `index.html` ส่วน logic: ลบ `function buildChangeLog` และชื่อ `buildChangeLog` ใน `module.exports`
- Test: `tests/rebalance.js` (ลบ test `buildChangeLog sums per-hour moves ...`), `tests/browser_e2e.py`

**Interfaces:**
- Consumes: `diffTimesheets`, `cellTotals`, `cellKey` (Task 1), `normalizeKey`, `normalizeWO`
- Produces (ส่วน UI): `refresh({ replan: boolean })`, `scheduleAutoRefresh()`, `markChangedCells()`, ค่าคงที่ `AUTO_REFRESH_MS = 300` ส่วน Task 5 จะเพิ่ม `rebalanceDraft = null;` ใน branch `replan` ของ `refresh`

- [ ] **Step 1: เขียน browser test ที่ยังไม่ผ่าน + แก้ test เดิม** ใน `tests/browser_e2e.py`

(a) ในฟังก์ชัน `apply_then_undo_round_trips_the_timesheet` แทนที่ 3 บรรทัดนี้:

```python
    log_row = page.locator('#changelog-container tbody tr')
    expect(log_row).to_have_count(1)
    expect(log_row.first.locator('td')).to_have_text(['Dev1', 'S1', 'O1', 'C1', '11', '2'])
```

ด้วย:

```python
    log = page.locator('#changelog-container tbody tr')
    expect(log).to_have_count(2)
    expect(log.nth(0).locator('td')).to_have_text(['Dev1', 'S1', 'C1', '11', '', '2', 'Rebalance'])
    expect(log.nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '11', '8', '6', 'Rebalance'])
```

(b) ในฟังก์ชัน `target_wo_dropdown_redirects_the_move` แทนที่บรรทัด

```python
    expect(page.locator('#changelog-container tbody tr td').nth(3)).to_have_text('C2')
```

ด้วย

```python
    expect(page.locator('#changelog-container tbody tr').nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'C2', '11', '', '2', 'Rebalance'])
```

(c) เพิ่มฟังก์ชันใหม่เหล่านี้ไว้ก่อน `def downloaded_new_timesheet_uploads_back_with_the_edits`:

```python
def after_apply_editing_a_cell_refreshes_tables_without_run(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('79.55%')
    grid_cell(page, 'timesheet-grid', 1, day_col(10)).fill('7')  # O1 day 10: 8 -> 7
    grid_cell(page, 'timesheet-grid', 0, day_col(10)).fill('1')  # C1 day 10: blank -> 1
    expect(opex_cell(page, 'S1')).to_have_text('78.41%')         # 69 / 88, no Run click
    expect(summary_row(page, 'S1').locator('td').nth(2)).to_have_text('81.82% → 78.41%')
    log = page.locator('#changelog-container tbody tr')
    expect(log).to_have_count(4)
    expect(log.nth(0).locator('td')).to_have_text(['Dev1', 'S1', 'C1', '10', '', '1', 'แก้เอง'])
    expect(log.nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'C1', '11', '', '2', 'Rebalance'])
    expect(log.nth(2).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '10', '8', '7', 'แก้เอง'])
    expect(log.nth(3).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '11', '8', '6', 'Rebalance'])


def after_apply_changed_cells_are_highlighted_with_the_old_value(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    opex11 = grid_cell(page, 'timesheet-grid', 1, day_col(11))
    capex11 = grid_cell(page, 'timesheet-grid', 0, day_col(11))
    expect(opex11).to_have_class(re.compile('cell-changed'))
    expect(opex11).to_have_attribute('title', 'เดิม: 8')
    expect(capex11).to_have_attribute('title', 'เดิม: ว่าง')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).not_to_have_class(re.compile('cell-changed'))
    opex11.fill('8')   # put the original values back by hand
    capex11.fill('')
    expect(opex11).not_to_have_class(re.compile('cell-changed'))
    expect(page.locator('#changelog-card')).to_be_hidden()
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')


def editing_over_a_rebalance_cell_counts_as_manual(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    grid_cell(page, 'timesheet-grid', 1, day_col(11)).fill('5')
    expect(page.locator('#changelog-container tbody tr').nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '11', '8', '5', 'แก้เอง'])


def typing_in_the_timesheet_after_apply_keeps_focus(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    cell = grid_cell(page, 'timesheet-grid', 1, day_col(10))
    cell.click()
    page.keyboard.press('Control+A')
    page.keyboard.type('7')
    expect(opex_cell(page, 'S1')).to_have_text('79.31%')  # 69 / 87, after the auto refresh
    assert cell.evaluate('el => el === document.activeElement'), 'focus left the cell after the auto refresh'


def manual_edits_survive_a_reload(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    grid_cell(page, 'timesheet-grid', 1, day_col(10)).fill('7')
    expect(page.locator('#changelog-container')).to_contain_text('แก้เอง')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('#changelog-container')).to_contain_text('แก้เอง')
    expect(page.locator('#changelog-container')).to_contain_text('Rebalance')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).to_have_class(re.compile('cell-changed'))


def undo_after_manual_edits_restores_the_original(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    grid_cell(page, 'timesheet-grid', 1, day_col(10)).fill('7')
    expect(opex_cell(page, 'S1')).to_have_text('79.31%')
    page.click('[data-rb-action="undo"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).to_have_value('8')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('8')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).not_to_have_class(re.compile('cell-changed'))
    expect(page.locator('#changelog-card')).to_be_hidden()


def before_apply_editing_waits_for_run(page):
    setup_over_80(page)
    grid_cell(page, 'timesheet-grid', 1, day_col(3)).fill('0')
    page.wait_for_timeout(700)  # longer than the 300 ms auto refresh would take
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')
    page.click('#run-btn')
    expect(opex_cell(page, 'S1')).to_have_text('80.00%')  # 64 / 80
```

(d) เพิ่มรายการเหล่านี้ใน `TESTS` ต่อจาก `('the summary flags a squad that is still over 80% in red', summary_flags_a_squad_still_over_80),`:

```python
    ('after Apply, editing a timesheet cell refreshes Table 2 / summary / history without Run', after_apply_editing_a_cell_refreshes_tables_without_run),
    ('after Apply, changed cells are yellow with "เดิม: …", and clear when typed back', after_apply_changed_cells_are_highlighted_with_the_old_value),
    ('typing over a cell Rebalance changed is logged as แก้เอง', editing_over_a_rebalance_cell_counts_as_manual),
    ('the auto refresh after Apply keeps focus in the cell being typed in', typing_in_the_timesheet_after_apply_keeps_focus),
    ('manual edits and their history survive a reload', manual_edits_survive_a_reload),
    ('Undo after manual edits restores the original timesheet', undo_after_manual_edits_restores_the_original),
    ('before Apply, editing the timesheet still waits for Run', before_apply_editing_waits_for_run),
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: test ใหม่ 6 ข้อแรก กับ 2 ข้อที่แก้ (a), (b) ต้อง `FAIL` ส่วน `before Apply, editing the timesheet still waits for Run` ผ่านอยู่แล้ว เพราะเป็นพฤติกรรมเดิม

- [ ] **Step 3: แยกงานของปุ่ม Run ออกเป็น `refresh`** ใน `index.html` หา:

```js
  runBtn.addEventListener('click', () => {
    clearBanners();
    rebalanceCard.hidden = true; rebalanceIncludeRound2 = false; rebalanceOverrides = {};
```

แทนด้วย:

```js
  // Run = refresh({ replan: true }): rebuild everything and start a fresh
  // rebalance suggestion. The auto refresh after Apply uses replan: false so
  // in-progress choices (round 2, the draft) survive.
  function refresh(opts) {
    renderTablesAndRebalance(!!(opts && opts.replan));
    renderChangeLog();
    markChangedCells();
  }
  runBtn.addEventListener('click', () => refresh({ replan: true }));

  function renderTablesAndRebalance(replan) {
    clearBanners();
    rebalanceCard.hidden = true;
    if (replan) { rebalanceIncludeRound2 = false; rebalanceOverrides = {}; }
```

แล้วที่ท้ายฟังก์ชันเดียวกัน (ก่อน `function flashButton`) แทน:

```js
    lastTable2 = table2;
    renderRebalance();
    renderChangeLog();
  });
```

ด้วย:

```js
    lastTable2 = table2;
    renderRebalance();
  }
```

(early `return` ด้านบนที่เรียก `renderRebalance(); return;` ปล่อยไว้เหมือนเดิม เพราะ `refresh` จะเรียก `renderChangeLog()` กับ `markChangedCells()` ต่อให้เสมอ)

- [ ] **Step 4: คำนวณใหม่อัตโนมัติ + ระบายสีช่อง** วางต่อจาก `runBtn.addEventListener('click', () => refresh({ replan: true }));`

```js
  // After Apply, editing the timesheet refreshes tables, summary, history and
  // highlights on its own — 300 ms after the last keystroke, so typing a
  // number doesn't recompute on every key. Only cell classes/titles change
  // in the grid, never its inputs, so the cursor stays put.
  const AUTO_REFRESH_MS = 300;
  let autoRefreshTimer = null;
  function scheduleAutoRefresh() {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(() => refresh({ replan: false }), AUTO_REFRESH_MS);
  }

  // Yellow + "เดิม: x" on every timesheet day cell whose value differs from
  // the original (compared by person/squad/WO, not row position).
  function markChangedCells() {
    const before = rebalanceState ? cellTotals(rebalanceState.original).totals : null;
    const after = rebalanceState ? cellTotals(timesheetGrid.getRows()).totals : null;
    const round = v => Math.round(v * 1e6) / 1e6;
    timesheetGridMount.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('input, select'));
      const key = cellKey(normalizeKey(String(cells[0].value).trim()), String(cells[1].value).trim() || '(Unspecified)', normalizeWO(cells[2].value));
      for (let d = 0; d < 31; d++) {
        const el = cells[5 + d];
        if (!el) continue;
        const b = before && before[key] ? before[key][d] : 0;
        const a = after && after[key] ? after[key][d] : 0;
        const changed = !!before && round(b) !== round(a);
        el.classList.toggle('cell-changed', changed);
        if (changed) el.title = 'เดิม: ' + (round(b) === 0 ? 'ว่าง' : round(b));
        else el.removeAttribute('title');
      }
    });
  }
```

ใน `createGridEditor(timesheetGridMount, TIMESHEET_COLUMNS, timesheetAddRowBtn, 8, () => { ... }, true);` แทนบรรทัด

```js
    if (rebalanceState) persistTimesheetText();
```

ด้วย

```js
    if (rebalanceState) { persistTimesheetText(); scheduleAutoRefresh(); }
```

- [ ] **Step 5: ให้ Apply / Undo / startup เรียก `refresh`** ใน `applyRebalance()` แทน `runBtn.click();` ด้วย `refresh({ replan: true });` ส่วนใน `undoRebalance()` ให้แทนทั้งฟังก์ชันด้วย:

```js
  function undoRebalance() {
    if (!rebalanceState) return;
    clearTimeout(autoRefreshTimer);
    setTimesheetRows(rebalanceState.original);
    clearRebalanceState();
    lastBefore = null; changelogCard.hidden = true;
    refresh({ replan: true });
  }
```

startup block ท้าย IIFE แทน:

```js
    try { renderRebalance(); renderChangeLog(); } catch (e) { /* ignore */ }
```

ด้วย

```js
    try { renderRebalance(); renderChangeLog(); markChangedCells(); } catch (e) { /* ignore */ }
```

- [ ] **Step 6: ประวัติแบบ diff** แทนทั้งฟังก์ชัน `renderChangeLog` และ `buildChangeLogClipboardHTML` ด้วย:

```js
  function renderChangeLog() {
    const log = rebalanceState ? diffTimesheets(rebalanceState.original, timesheetGrid.getRows(), rebalanceState.moves) : null;
    if (!log || log.rows.length === 0) {
      changelogCard.hidden = true;
      changelogContainer.innerHTML = '';
      lastChangeLogRows = null;
      return;
    }
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
      html += '<tr>' + r.map((c, i) => clipCell('td', typeof c === 'number' ? String(Math.round(c * 100) / 100) : c, '#ffffff', i >= 3 && i <= 5 ? 'right' : 'left', false)).join('') + '</tr>';
    });
    return html + '</table>';
  }
```

ลบ `function buildChangeLog(moves) { ... }` ในส่วน logic ลบชื่อ `buildChangeLog` ออกจาก `module.exports` และลบ test `buildChangeLog sums per-hour moves into one line per person/WO pair/day` (ทั้งบล็อก `test(...)`) ใน `tests/rebalance.js` และแก้หัว comment `// ---- applyMoves / buildChangeLog / summarizeRows` เป็น `// ---- applyMoves / summarizeRows`

- [ ] **Step 7: CSS สีของช่อง** ใน `<style>` ต่อจากบรรทัด `#rebalance-container .row { margin-top: 12px; }` เพิ่ม:

```css
  table.input-grid input.cell-changed { background: var(--warn-bg); color: var(--warn-text); font-weight: 600; }
```

- [ ] **Step 8: รัน test ทั้งหมดต้องผ่าน**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 41 browser tests passed`

- [ ] **Step 9: Commit**

```bash
git add index.html tests/rebalance.js tests/browser_e2e.py
git commit -m "feat: after Apply, timesheet edits refresh tables, highlight changed cells, and log แก้เอง vs Rebalance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ก่อน Apply: ตารางร่างระดับวันแทนตารางคำแนะนำเดิม

**Files:**
- Modify: `index.html` ส่วน UI ได้แก่ state `rebalanceOverrides` (ลบ), `clearRebalanceState`, `currentPlan`, `renderRebalance`, `applyRebalance`, handler `click` / `change` ของ `rebalanceContainer`, `renderTablesAndRebalance` (Task 4), CSS
- Test: `tests/browser_e2e.py`

**Interfaces:**
- Consumes: `movesToDraft`, `draftRowDefaults` (Task 2), `resolveDraft` (Task 3), `refresh` (Task 4), `squadSummary`, `pctDiff`, `summarizeRows`, `extractEntries`, `buildRebalanceCtx`
- Produces (DOM ที่ test ใช้):
  - `#rebalance-container table.rb-draft tbody tr[data-draft-id]` 1 แถวต่อร่าง 1 แถว
  - ช่องในแถว: `[data-field="person"]` (select, value `nameKey|sq`), `[data-field="day"]` (select 1–31), `[data-field="mh"]` (input), `[data-field="fromWoKey"]`, `[data-field="toWoKey"]` (select, value = woKey)
  - ปุ่ม: `[data-rb-action="draft-del"]`, `[data-rb-action="draft-add"]`, `[data-rb-action="recalc"]`, `[data-rb-action="continue"]`, `[data-rb-action="apply"]`
  - ข้อความในแถว `td.rb-row-msg` (error: `span.rb-msg-error`, warning: `span.rb-msg-warn`), แถวที่มี error ได้ class `rb-row-error`
  - `#rb-draft-preview` ตาราง "ถ้า Apply ตามนี้" (`table.rb-preview`)

- [ ] **Step 1: เขียน browser test ที่ยังไม่ผ่าน + แก้ test เดิม** ใน `tests/browser_e2e.py`

(a) เพิ่ม helper ต่อจาก `def table1_cell(...)`:

```python
def draft_rows(page):
    return page.locator('#rebalance-container table.rb-draft tbody tr')


def draft_field(page, index, field):
    return draft_rows(page).nth(index).locator('[data-field="' + field + '"]')
```

(b) ใน `continue_runs_round_2_when_round_1_is_not_enough` แทนบรรทัด

```python
    expect(rebalance).to_contain_text('✓ S1: OPEX 94.74% → 78.95%')
```

ด้วย

```python
    expect(page.locator('#rb-draft-preview')).to_contain_text('94.74% → 78.95%')
```

(c) แทนทั้งฟังก์ชัน `target_wo_dropdown_redirects_the_move` ด้วย:

```python
def target_wo_dropdown_redirects_the_move(page):
    setup_over_80(page)
    expect(draft_field(page, 0, 'toWoKey')).to_have_value('C1')  # Dev1's own CAPEX WO comes first
    draft_field(page, 0, 'toWoKey').select_option('C2')          # a CAPEX WO Dev1 has no row for yet
    expect(draft_field(page, 0, 'toWoKey')).to_have_value('C2')

    page.click('[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(11))).to_have_value('')  # C1 untouched
    expect(page.locator('#changelog-card')).to_be_visible()  # Apply has finished re-rendering
    new_row = grid_row_where(page, 'timesheet-grid', 2, 'C2')
    expect(new_row.locator('input').nth(0)).to_have_value('Dev1')
    expect(new_row.locator('input').nth(day_col(11))).to_have_value('2')
    expect(page.locator('#changelog-container tbody tr').nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'C2', '11', '', '2', 'Rebalance'])
```

(d) ใน `copy_new_timesheet_warns_about_added_rows` แทนบรรทัด

```python
    page.locator('#rebalance-container select.rb-target').select_option('C2')  # Dev1 has no C2 row
```

ด้วย

```python
    draft_field(page, 0, 'toWoKey').select_option('C2')  # Dev1 has no C2 row
```

(e) เพิ่มฟังก์ชันใหม่เหล่านี้ไว้ก่อน `def apply_survives_a_reload`:

```python
def draft_lists_the_plan_per_day_with_a_preview(page):
    setup_over_80(page)
    expect(draft_rows(page)).to_have_count(1)
    expect(draft_field(page, 0, 'person')).to_have_value('dev1|S1')
    expect(draft_field(page, 0, 'day')).to_have_value('11')
    expect(draft_field(page, 0, 'mh')).to_have_value('2')
    expect(draft_field(page, 0, 'fromWoKey')).to_have_value('O1')
    expect(draft_field(page, 0, 'toWoKey')).to_have_value('C1')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 79.55%')


def editing_draft_mh_updates_the_preview_and_what_apply_does(page):
    setup_over_80(page)
    mh = draft_field(page, 0, 'mh')
    mh.fill('4')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 77.27%')  # 68 / 88
    assert mh.evaluate('el => el === document.activeElement'), 'typing MH must not re-render the draft table'
    page.click('[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('4')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(11))).to_have_value('4')
    expect(page.locator('#changelog-container')).not_to_contain_text('แก้เอง')


def editing_draft_day_moves_a_different_day(page):
    setup_over_80(page)
    draft_field(page, 0, 'day').select_option('10')
    page.click('[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).to_have_value('6')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('8')


def draft_mh_over_the_day_is_an_error_and_blocks_apply(page):
    setup_over_80(page)
    draft_field(page, 0, 'mh').fill('9')
    expect(draft_rows(page).nth(0)).to_have_class(re.compile('rb-row-error'))
    expect(draft_rows(page).nth(0).locator('td.rb-row-msg')).to_contain_text('วันที่ 11 ของ O1 เหลือให้ย้ายได้ 8 MH')
    expect(page.locator('[data-rb-action="apply"]')).to_be_disabled()
    draft_field(page, 0, 'mh').fill('2')
    expect(page.locator('[data-rb-action="apply"]')).to_be_enabled()


def deleting_the_only_draft_row_disables_apply(page):
    setup_over_80(page)
    page.click('[data-rb-action="draft-del"]')
    expect(draft_rows(page)).to_have_count(0)
    expect(page.locator('[data-rb-action="apply"]')).to_be_disabled()
    expect(page.locator('#rb-draft-preview')).to_be_empty()


def adding_a_draft_row_uses_sensible_defaults(page):
    setup_over_80(page)
    page.click('[data-rb-action="draft-add"]')
    expect(draft_rows(page)).to_have_count(2)
    expect(draft_field(page, 1, 'person')).to_have_value('dev1|S1')
    expect(draft_field(page, 1, 'fromWoKey')).to_have_value('O1')
    expect(draft_field(page, 1, 'toWoKey')).to_have_value('C1')
    expect(draft_field(page, 1, 'day')).to_have_value('11')
    expect(draft_field(page, 1, 'mh')).to_have_value('1')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 78.41%')  # 69 / 88


def changing_the_person_resets_the_row_defaults(page):
    setup(page, MAPPING, OVER_80 + [
        timesheet_row('Ann', 'S1', 'C2', {1: 8}),
        timesheet_row('Ann', 'S1', 'O1', {20: 8, 21: 8, 22: 8, 23: 8}),
    ], DEV1)
    page.click('[data-rb-action="draft-add"]')
    last = draft_rows(page).count() - 1
    draft_field(page, last, 'person').select_option('ann|S1')
    expect(draft_field(page, last, 'fromWoKey')).to_have_value('O1')
    expect(draft_field(page, last, 'toWoKey')).to_have_value('C2')
    expect(draft_field(page, last, 'day')).to_have_value('23')
    expect(draft_field(page, last, 'mh')).to_have_value('1')


def draft_ceiling_warning_does_not_block_apply(page):
    setup(page, MAPPING, OVER_80, DEV1, working_days='1')  # CAPEX ceiling 16 MD x 1/20 = 0.8 MD
    page.click('[data-rb-action="draft-add"]')
    expect(draft_rows(page).last.locator('td.rb-row-msg')).to_contain_text('เกินเพดาน')
    expect(page.locator('[data-rb-action="apply"]')).to_be_enabled()


def recalc_discards_draft_edits(page):
    setup_over_80(page)
    draft_field(page, 0, 'mh').fill('4')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 77.27%')
    page.click('[data-rb-action="recalc"]')
    expect(draft_field(page, 0, 'mh')).to_have_value('2')
```

(f) เพิ่มรายการเหล่านี้ใน `TESTS` ต่อจาก `('a role missing from Role Ceilings is skipped with a reason', unknown_role_is_skipped_with_a_reason),`:

```python
    ('the draft lists the plan per day with an "ถ้า Apply ตามนี้" preview', draft_lists_the_plan_per_day_with_a_preview),
    ('editing draft MH updates the preview and what Apply writes', editing_draft_mh_updates_the_preview_and_what_apply_does),
    ('editing the draft day moves hours on that day instead', editing_draft_day_moves_a_different_day),
    ('draft MH over what the day holds is an error and blocks Apply', draft_mh_over_the_day_is_an_error_and_blocks_apply),
    ('deleting the only draft row empties the preview and disables Apply', deleting_the_only_draft_row_disables_apply),
    ('+ เพิ่มการย้าย adds a row with sensible defaults', adding_a_draft_row_uses_sensible_defaults),
    ('changing a draft row\'s person resets its from/to/day/MH', changing_the_person_resets_the_row_defaults),
    ('a CAPEX-ceiling warning in the draft does not block Apply', draft_ceiling_warning_does_not_block_apply),
    ('คำนวณคำแนะนำใหม่ throws away draft edits', recalc_discards_draft_edits),
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: test ใหม่ทั้ง 9 ข้อ กับ test ที่แก้ (b), (c), (d) ต้อง `FAIL` (เช่น `Locator expected to have count '1'`)

- [ ] **Step 3: state ของร่าง** ใน `index.html` แทนบรรทัด

```js
  let rebalanceOverrides = {};
```

ด้วย

```js
  // Editable rebalance suggestion (spec: docs/superpowers/specs/2026-10-20-editable-rebalance-design.md).
  // null = "build one from the current plan on the next render".
  let rebalanceDraft = null;
  let nextDraftId = 1;
```

ใน `clearRebalanceState()` แทนบรรทัด `rebalanceOverrides = {};` ด้วย `rebalanceDraft = null;`
ใน `renderTablesAndRebalance(replan)` (Task 4) แทน `if (replan) { rebalanceIncludeRound2 = false; rebalanceOverrides = {}; }` ด้วย `if (replan) { rebalanceIncludeRound2 = false; rebalanceDraft = null; }`
ใน `currentPlan()` แทน `{ includeRound2: rebalanceIncludeRound2, targetOverrides: rebalanceOverrides }` ด้วย `{ includeRound2: rebalanceIncludeRound2 }`
ใน `applyRebalance()` ลบ 2 บรรทัด `rebalanceIncludeRound2 = false;` และ `rebalanceOverrides = {};` (เพราะ `refresh({ replan: true })` ทำให้แล้ว)

- [ ] **Step 4: helper ของร่าง** วางก่อน `function renderRebalance()`

```js
  function withDraftIds(rows) { return rows.map(r => Object.assign({ id: nextDraftId++ }, r)); }
  function draftCtx() { return buildRebalanceCtx(timesheetGrid.getRows(), parseMappingText(mappingInput.value)); }
  function canApply(res) { return res.moves.length > 0 && Object.keys(res.errors).length === 0; }

  function personOptions(entries) {
    const seen = {}, out = [];
    entries.forEach(e => {
      const value = e.nameKey + '|' + e.sq;
      if (!e.nameKey || seen[value]) return;
      seen[value] = true;
      out.push({ value: value, nameKey: e.nameKey, sq: e.sq, name: e.name });
    });
    return out;
  }

  function optionHtml(value, label, selected) {
    return '<option value="' + escapeHtml(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
  }

  function draftMessageHtml(res, id) {
    if (res.errors[id]) return '<span class="rb-msg-error">✕ ' + escapeHtml(res.errors[id]) + '</span>';
    return (res.warnings[id] || []).map(w => '<span class="rb-msg-warn">⚠ ' + escapeHtml(w) + '</span>').join('<br>');
  }

  function renderDraftTable(draft, ctx, res) {
    const entries = extractEntries(ctx.rowArrays, ctx.mapping);
    const people = personOptions(entries);
    const capex = Object.keys(ctx.mapping.map).filter(k => ctx.mapping.map[k].category === 'CAPEX');
    const woLabel = k => { const m = ctx.mapping.map[k]; return m ? m.wo + (m.name && m.name !== m.wo ? ' — ' + m.name : '') : k; };
    let html = '<div class="table-scroll"><table class="rb-draft"><thead><tr><th>ชื่อ · Squad</th><th>วัน</th><th>MH</th><th>จาก WO</th><th>ไป CAPEX WO</th><th></th><th></th></tr></thead><tbody>';
    draft.forEach(d => {
      const id = escapeHtml(String(d.id));
      const personValue = d.nameKey + '|' + d.sq;
      const pOpts = people.some(p => p.value === personValue) ? people : [{ value: personValue, name: d.name, sq: d.sq }].concat(people);
      const mine = entries.filter(e => e.nameKey === d.nameKey && e.sq === d.sq);
      const fromKeys = mine.map(e => e.woKey).filter((k, i, a) => a.indexOf(k) === i);
      if (fromKeys.indexOf(d.fromWoKey) < 0) fromKeys.unshift(d.fromWoKey);
      const own = capex.filter(k => mine.some(e => e.woKey === k));
      const toKeys = own.concat(capex.filter(k => own.indexOf(k) < 0));
      if (toKeys.indexOf(d.toWoKey) < 0) toKeys.unshift(d.toWoKey);
      html += '<tr data-draft-id="' + id + '"' + (res.errors[d.id] ? ' class="rb-row-error"' : '') + '>' +
        '<td><select data-field="person" data-draft-id="' + id + '">' + pOpts.map(p => optionHtml(p.value, p.name + ' · ' + p.sq, p.value === personValue)).join('') + '</select></td>' +
        '<td><select data-field="day" data-draft-id="' + id + '">' + Array.from({ length: 31 }, (_, i) => optionHtml(String(i + 1), String(i + 1), i + 1 === Number(d.day))).join('') + '</select></td>' +
        '<td><input type="text" inputmode="decimal" class="rb-mh" data-field="mh" data-draft-id="' + id + '" value="' + escapeHtml(String(d.mh)) + '"></td>' +
        '<td><select data-field="fromWoKey" data-draft-id="' + id + '">' + fromKeys.map(k => optionHtml(k, woLabel(k), k === d.fromWoKey)).join('') + '</select></td>' +
        '<td><select data-field="toWoKey" data-draft-id="' + id + '">' + toKeys.map(k => optionHtml(k, woLabel(k), k === d.toWoKey)).join('') + '</select></td>' +
        '<td><button type="button" class="btn" data-rb-action="draft-del" data-draft-id="' + id + '" title="ลบแถวนี้">🗑</button></td>' +
        '<td class="rb-row-msg" data-draft-id="' + id + '">' + draftMessageHtml(res, d.id) + '</td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  // "ถ้า Apply ตามนี้": only the squads whose % would change.
  function draftPreviewHtml(ctx, res) {
    if (res.moves.length === 0) return '';
    const s = squadSummary(summarizeRows(res.previewRows, ctx.mapping).table2, summarizeRows(ctx.rowArrays, ctx.mapping).table2);
    const changed = s.rows.filter(r => formatPct(r[1]) !== formatPct(r[2]) || formatPct(r[3]) !== formatPct(r[4]));
    if (changed.length === 0) return '';
    let html = '<p class="card-desc">ถ้า Apply ตามนี้:</p><div class="table-scroll"><table class="rb-preview"><thead><tr><th>Squad</th><th>CAPEX %</th><th>OPEX %</th></tr></thead><tbody>';
    changed.forEach(([sq, capexBefore, capexAfter, opexBefore, opexAfter]) => {
      const high = opexAfter != null && opexAfter > OPEX_PCT_ALERT_THRESHOLD;
      html += '<tr><td>' + escapeHtml(sq) + '</td><td>' + pctDiff(capexBefore, capexAfter).text + '</td>' +
        '<td' + (high ? ' class="pct-alert"' : '') + '>' + pctDiff(opexBefore, opexAfter).text + (high ? '' : ' ✓') + '</td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  // Typing MH only refreshes messages / preview / Apply, never the inputs,
  // so the cursor stays in the MH box.
  function updateDraftStatus() {
    const ctx = draftCtx();
    const res = resolveDraft(ctx.rowArrays, rebalanceDraft || [], ctx);
    rebalanceContainer.querySelectorAll('tr[data-draft-id]').forEach(tr => {
      const id = Number(tr.dataset.draftId);
      tr.classList.toggle('rb-row-error', !!res.errors[id]);
      const msg = tr.querySelector('.rb-row-msg');
      if (msg) msg.innerHTML = draftMessageHtml(res, id);
    });
    const preview = rebalanceContainer.querySelector('#rb-draft-preview');
    if (preview) preview.innerHTML = draftPreviewHtml(ctx, res);
    const apply = rebalanceContainer.querySelector('[data-rb-action="apply"]');
    if (apply) apply.disabled = !canApply(res);
  }
```

- [ ] **Step 5: `renderRebalance` ใหม่** แทนช่วงตั้งแต่ต้นฟังก์ชัน `function renderRebalance() {` จนถึงก่อนบรรทัด `    if (rebalanceState) {` (ในฟังก์ชันเดียวกัน) ด้วย:

```js
  function renderRebalance() {
    const plan = currentPlan();
    const flagged = plan.squads.filter(s => s.status !== 'ok');
    if (rebalanceDraft === null) rebalanceDraft = withDraftIds(movesToDraft(plan.moves));
    const showDraft = flagged.length > 0 || rebalanceDraft.length > 0;
    if (!showDraft && !rebalanceState) {
      rebalanceCard.hidden = true;
      rebalanceContainer.innerHTML = '';
      return;
    }
    rebalanceCard.hidden = false;
    let html = '';

    if (flagged.length > 0) {
      html += '<p class="card-desc">เพดานคำนวณจากวันทำงาน ' + escapeHtml(String(workingDaysValue() || '-')) + ' วัน (× วันทำงาน ÷ 20) — ระบบเสนอการย้ายทีละวันไว้ให้ แก้ ลบ หรือเพิ่มได้ก่อนกด Apply</p>';
    }
    flagged.forEach(s => {
      const after = formatPct(s.afterPct);
      if (s.status === 'needs-continue') {
        html += '<div class="banner warn">' + escapeHtml(s.sq) + ' ยังเหลือ OPEX ' + after + ' หลังย้ายตามเพดานของตำแหน่ง (รอบที่ 1) — กด "ทำต่อ" เพื่อลองย้ายคนที่ยังมีที่ว่างใน CAPEX (รอบที่ 2)</div>';
      } else if (s.status === 'unresolvable') {
        html += '<div class="banner warn">' + escapeHtml(s.sq) + ' ยังเหลือ OPEX ' + after + ' ไม่สามารถแก้ได้ภายในเพดานของตำแหน่ง — แก้เองในร่างหรือใน Timesheet</div>';
      }
    });
    if (plan.skipped.length > 0) {
      html += '<div class="banner warn">ข้ามคนที่ระบบแก้ให้ไม่ได้: ' +
        plan.skipped.map(s => escapeHtml(s.name || '(ไม่มีชื่อ)') + ' (' + escapeHtml(s.reason) + ')').join(', ') + '</div>';
    }

    if (showDraft) {
      const ctx = draftCtx();
      const res = resolveDraft(ctx.rowArrays, rebalanceDraft, ctx);
      const needsContinue = flagged.some(s => s.status === 'needs-continue');
      html += renderDraftTable(rebalanceDraft, ctx, res) +
        '<div class="row"><button type="button" class="btn" data-rb-action="draft-add">+ เพิ่มการย้าย</button>' +
        '<button type="button" class="btn" data-rb-action="recalc">↻ คำนวณคำแนะนำใหม่</button>' +
        (needsContinue ? '<button type="button" class="btn" data-rb-action="continue">ทำต่อ (รอบที่ 2)</button>' : '') + '</div>' +
        '<div id="rb-draft-preview">' + draftPreviewHtml(ctx, res) + '</div>' +
        '<div class="row"><button type="button" class="btn btn-primary" data-rb-action="apply"' + (canApply(res) ? '' : ' disabled') + '>Apply</button></div>';
    }
```

ส่วนที่เหลือของฟังก์ชัน (`if (rebalanceState) { ... }` และ `rebalanceContainer.innerHTML = html;`) ไม่ต้องแก้ ลบ `function fmtMD(mh) { ... }` ที่อยู่เหนือ `renderRebalance` ด้วย ถ้าไม่มีที่อื่นเรียกใช้แล้ว (เช็กด้วย `grep -n "fmtMD" index.html`)

- [ ] **Step 6: Apply จากร่าง** แทนทั้งฟังก์ชัน `applyRebalance` ด้วย:

```js
  function applyRebalance() {
    const ctx = draftCtx();
    const res = resolveDraft(ctx.rowArrays, rebalanceDraft || [], ctx);
    if (!canApply(res)) return;
    if (!rebalanceState) rebalanceState = { original: ctx.rowArrays.map(r => r.slice()), moves: [] };
    rebalanceState.moves = rebalanceState.moves.concat(res.moves);
    saveRebalanceState();
    setTimesheetRows(res.previewRows);
    persistTimesheetText();
    refresh({ replan: true });
  }
```

- [ ] **Step 7: event ของร่าง** ใน handler `rebalanceContainer.addEventListener('click', ...)` แทนบรรทัด

```js
    else if (action === 'continue') { rebalanceIncludeRound2 = true; renderRebalance(); }
```

ด้วย

```js
    else if (action === 'continue') { rebalanceIncludeRound2 = true; rebalanceDraft = null; renderRebalance(); }
    else if (action === 'recalc') { rebalanceDraft = null; renderRebalance(); }
    else if (action === 'draft-del') {
      rebalanceDraft = (rebalanceDraft || []).filter(d => d.id !== Number(btn.dataset.draftId));
      renderRebalance();
    } else if (action === 'draft-add') {
      const ctx = draftCtx();
      const p = personOptions(extractEntries(ctx.rowArrays, ctx.mapping))[0];
      if (!p) return;
      const row = Object.assign({ nameKey: p.nameKey, name: p.name, sq: p.sq, origin: 'user' }, draftRowDefaults(ctx.rowArrays, ctx.mapping, p.nameKey, p.sq));
      rebalanceDraft = (rebalanceDraft || []).concat(withDraftIds([row]));
      renderRebalance();
    }
```

แทนทั้ง handler `rebalanceContainer.addEventListener('change', ...)` เดิม (ที่เช็ก `rb-target`) ด้วย:

```js
  function draftRowFor(el) {
    return (rebalanceDraft || []).find(d => d.id === Number(el.dataset.draftId)) || null;
  }
  rebalanceContainer.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    const d = field && field !== 'mh' ? draftRowFor(e.target) : null;
    if (!d) return;
    if (field === 'person') {
      const ctx = draftCtx();
      const cut = e.target.value.indexOf('|');
      d.nameKey = e.target.value.slice(0, cut);
      d.sq = e.target.value.slice(cut + 1);
      const ent = extractEntries(ctx.rowArrays, ctx.mapping).find(x => x.nameKey === d.nameKey && x.sq === d.sq);
      if (ent) d.name = ent.name;
      Object.assign(d, draftRowDefaults(ctx.rowArrays, ctx.mapping, d.nameKey, d.sq));
    } else if (field === 'day') {
      d.day = Number(e.target.value);
    } else {
      d[field] = e.target.value;
    }
    renderRebalance();
  });
  rebalanceContainer.addEventListener('input', (e) => {
    if (e.target.dataset.field !== 'mh') return;
    const d = draftRowFor(e.target);
    if (!d) return;
    d.mh = e.target.value;
    updateDraftStatus();
  });
```

- [ ] **Step 8: CSS ของร่าง** ใน `<style>` ต่อจากบรรทัด `table.input-grid input.cell-changed { ... }` (Task 4) เพิ่ม:

```css
  #rebalance-container input.rb-mh { width: 64px; padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; text-align: right; }
  #rebalance-container tr.rb-row-error td { background: var(--error-bg); }
  #rebalance-container .rb-msg-error { color: var(--error-text); font-weight: 600; }
  #rebalance-container .rb-msg-warn { color: var(--warn-text); }
```

- [ ] **Step 9: เช็กว่าไม่เหลือของเดิม**

Run: `grep -n "rebalanceOverrides\|rb-target\|targetOverrides: rebalance" index.html`
Expected: ไม่มีผลลัพธ์ (`targetOverrides` ภายใน `planRebalance` ยังอยู่ได้ เพราะห้ามแก้ `planRebalance`)

- [ ] **Step 10: รัน test ทั้งหมดต้องผ่าน**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 50 browser tests passed`

- [ ] **Step 11: Commit**

```bash
git add index.html tests/browser_e2e.py
git commit -m "feat: editable day-level rebalance draft (edit/delete/add moves, preview, errors and warnings) before Apply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ตรวจรอบสุดท้าย

**Files:** ไม่มีไฟล์ใหม่ (แก้เฉพาะถ้าเจอปัญหา)

- [ ] **Step 1: test ทั้งหมด**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 50 browser tests passed`

- [ ] **Step 2: ดูหน้าจอจริง** แคปหน้าการ์ด Rebalance ทั้งก่อน Apply (มีร่าง 2 แถว แถวหนึ่งมี warning) และหลัง Apply (มีช่องสีเหลืองใน Timesheet) ด้วยสคริปต์ Playwright สั้น ๆ ใน scratchpad โดยใช้ `setup_over_80` จาก `tests/browser_e2e.py` แล้วเปิดดูรูปว่าตารางร่างไม่ล้นจอ (กว้าง 1100px) ไม่มีข้อความทับกัน และปุ่มอยู่ครบ

- [ ] **Step 3: ทวนกับ spec** เปิด spec ไล่ทีละหัวข้อ (ส่วนที่ 1 การสร้างร่าง / การแก้ร่าง / validate / Apply, ส่วนที่ 2 ทุกหัวข้อ) แล้วชี้ให้ได้ว่าแต่ละข้ออยู่ใน test ข้อไหน ข้อไหนไม่มี test ให้บอก user

- [ ] **Step 4: ถาม user ก่อน push** สรุปให้ user ฟังว่าทำอะไรไปบ้าง แล้วถามว่าจะ `git push origin master` ไหม (push แล้ว GitHub Pages จะ deploy ภายใน 1–2 นาที)
