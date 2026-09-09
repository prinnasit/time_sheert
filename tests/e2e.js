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

test('table1 has the 4 squads in first-seen order with correct Man-Day totals (MH ÷ 8)', () => {
  assert.deepStrictEqual(table1.squads, ['KSB_Elephant', 'KSB_Orca', 'KSB_Pony', 'KSB_Lead']);
  assert.strictEqual(table1.rowTotals['KSB_Elephant'], 4);
  assert.strictEqual(table1.rowTotals['KSB_Orca'], 5);
  assert.strictEqual(table1.rowTotals['KSB_Pony'], 2.5);
  assert.strictEqual(table1.rowTotals['KSB_Lead'], 2);
  assert.strictEqual(table1.grandTotal, 13.5);
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
  assert.strictEqual(App.formatPct(bySq['KSB_Lead'].capexPct), '–');
});

process.on('exit', () => {
  if (failures > 0) { console.log(failures + ' failing test(s)'); process.exitCode = 1; }
  else { console.log('All e2e tests passed'); }
});
