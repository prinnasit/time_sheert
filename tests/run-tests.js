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
