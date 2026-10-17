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
