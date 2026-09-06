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

test('formatMH rounds to 2 decimals', () => {
  assert.strictEqual(App.formatMH(10), '10.00');
  assert.strictEqual(App.formatMH(10.005), '10.01');
});

test('formatPct renders a dash for null and a percentage otherwise', () => {
  assert.strictEqual(App.formatPct(null), '–');
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

process.on('exit', () => {
  if (failures > 0) {
    console.log(failures + ' failing test(s)');
    process.exitCode = 1;
  } else {
    console.log('All tests passed');
  }
});
