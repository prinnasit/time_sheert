// tests/run-tests.js — unit tests for ../Logic.js (pure functions only,
// no SpreadsheetApp/Sheets dependency, so this runs with plain `node`).
const assert = require('assert');
const Logic = require('../Logic.js');

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

test('normalizeCategory_ recognizes CAPEX/OPEX/Non Charge variants', () => {
  assert.strictEqual(Logic.normalizeCategory_('CAPEX'), 'CAPEX');
  assert.strictEqual(Logic.normalizeCategory_('opex'), 'OPEX');
  assert.strictEqual(Logic.normalizeCategory_('Non Charge'), 'NON_CHARGE');
  assert.strictEqual(Logic.normalizeCategory_('Nonchargable'), 'NON_CHARGE');
  assert.strictEqual(Logic.normalizeCategory_('bogus'), null);
});

test('buildMappingIndex_ skips rows with blank WO No. or unrecognized category', () => {
  const idx = Logic.buildMappingIndex_([
    ['CAPEX-001', 'CAPEX', 'ONE Corporate MVP1'],
    ['', 'CAPEX', 'Should be skipped: no WO No.'],
    ['Z99', 'not a real category', 'Should be skipped: bad category'],
    ['Z01', 'Non Charge', 'Leave / Day-Off']
  ]);
  assert.deepStrictEqual(idx['CAPEX-001'], { wo: 'CAPEX-001', category: 'CAPEX', name: 'ONE Corporate MVP1' });
  assert.deepStrictEqual(idx['Z01'], { wo: 'Z01', category: 'NON_CHARGE', name: 'Leave / Day-Off' });
  assert.strictEqual(Object.keys(idx).length, 2);
});

test('parseTimesheetRow_ sums daily MH and defaults blank SQ', () => {
  const row = ['Alice', '', 'CAPEX-001', 'MVP1', 1, 8, 8, '', 4];
  const result = Logic.parseTimesheetRow_(row, 'Squad A', 3);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.row.sq, '(Unspecified)');
  assert.strictEqual(result.row.mh, 20);
  assert.strictEqual(result.row.source, 'Squad A');
  assert.strictEqual(result.row.rowNumber, 3);
});

test('parseTimesheetRow_ rejects missing WO No. and non-numeric MH cells', () => {
  assert.strictEqual(Logic.parseTimesheetRow_(['Alice', 'SQ1', '', 'MVP1', 1, 8], 'S', 3).ok, false);
  assert.strictEqual(Logic.parseTimesheetRow_(['Bob', 'SQ1', 'CAPEX-001', 'MVP1', 1, 'x'], 'S', 4).ok, false);
});

test('classifyRow_ tags UNMAPPED and never silently defaults to a category', () => {
  const mapping = Logic.buildMappingIndex_([['CAPEX-001', 'CAPEX', 'MVP1']]);
  const mapped = Logic.classifyRow_({ sq: 'SQ1', woNo: 'CAPEX-001', woName: '', mh: 10 }, mapping);
  const unmapped = Logic.classifyRow_({ sq: 'SQ1', woNo: 'W999', woName: 'Unknown', mh: 5 }, mapping);
  assert.strictEqual(mapped.category, 'CAPEX');
  assert.strictEqual(mapped.woLabel, 'MVP1');
  assert.strictEqual(unmapped.category, 'UNMAPPED');
  assert.deepStrictEqual(Logic.unmappedWOs_([mapped, unmapped]), ['W999']);
});

test('buildTable1_ groups columns by category and computes totals', () => {
  const classified = [
    { sq: 'SQ1', woKey: 'C1', woLabel: 'C1', category: 'CAPEX', mh: 10 },
    { sq: 'SQ1', woKey: 'O1', woLabel: 'O1', category: 'OPEX', mh: 5 },
    { sq: 'SQ2', woKey: 'C1', woLabel: 'C1', category: 'CAPEX', mh: 3 }
  ];
  const table = Logic.buildTable1_(classified);
  assert.deepStrictEqual(table.squads, ['SQ1', 'SQ2']);
  assert.deepStrictEqual(table.columns.map(c => c.key), ['C1', 'O1']);
  assert.strictEqual(table.rowTotals.SQ1, 15);
  assert.strictEqual(table.colTotals.C1, 13);
  assert.strictEqual(table.grandTotal, 18);
});

test('buildTable2_ computes chargeable percentages and nulls out squads with no chargeable MH', () => {
  const classified = [
    { sq: 'SQ1', category: 'CAPEX', mh: 6 },
    { sq: 'SQ1', category: 'OPEX', mh: 2 },
    { sq: 'SQ2', category: 'NON_CHARGE', mh: 4 }
  ];
  const table = Logic.buildTable2_(classified);
  const sq1 = table.find(r => r.sq === 'SQ1');
  const sq2 = table.find(r => r.sq === 'SQ2');
  assert.strictEqual(sq1.capexPct, 0.75);
  assert.strictEqual(sq2.capexPct, null);
});

test('roundMH_ rounds to 2 decimals as a number, not a string', () => {
  assert.strictEqual(Logic.roundMH_(10), 10);
  assert.strictEqual(Logic.roundMH_(10.005), 10.01);
  assert.strictEqual(typeof Logic.roundMH_(1 / 3), 'number');
});

test('end-to-end: standard sample dataset (4 squads, 1 unmapped WO) matches the web tool\'s expected numbers', () => {
  const mapping = Logic.buildMappingIndex_([
    ['CAPEX-001', 'CAPEX', 'ONE Corporate MVP1'],
    ['CAPEX-002', 'CAPEX', 'KBank Mobile Revamp'],
    ['OPEX-001', 'OPEX', 'Production Support'],
    ['Z01', 'Non Charge', 'Leave / Day-Off'],
    ['Z02', 'Non Charge', 'Training / Meeting']
  ]);

  function row(name, sq, woNo, woName, values) {
    const days = new Array(31).fill(0);
    Object.keys(values).forEach(k => { days[Number(k) - 1] = values[k]; });
    return [name, sq, woNo, woName, 1].concat(days);
  }

  const rawRows = [
    row('Somchai Jaidee', 'KSB_Elephant', 'CAPEX-001', 'ONE Corporate MVP1', { 1: 8, 2: 8, 3: 8 }),
    row('Somsri Rakthai', 'KSB_Elephant', 'OPEX-001', 'Production Support', { 1: 4, 2: 4 }),
    row('Anan Chai', 'KSB_Orca', 'CAPEX-002', 'KBank Mobile Revamp', { 1: 8, 2: 8, 3: 8, 4: 8 }),
    row('Anan Chai', 'KSB_Orca', 'Z01', 'Leave / Day-Off', { 5: 8 }),
    row('Piti Suk', 'KSB_Pony', 'CAPEX-001', 'ONE Corporate MVP1', { 1: 8, 2: 8 }),
    row('Piti Suk', 'KSB_Pony', 'Z02', 'Training / Meeting', { 3: 4 }),
    row('Malee Somsri', 'KSB_Lead', 'W999-UNKNOWN', 'Some Unknown WO', { 1: 8, 2: 8 })
  ];

  const parsedRows = rawRows.map((r, i) => Logic.parseTimesheetRow_(r, 'TestSquad', i + 3));
  assert.ok(parsedRows.every(p => p.ok), 'all sample rows should parse cleanly');

  const classified = parsedRows.map(p => Logic.classifyRow_(p.row, mapping));
  assert.deepStrictEqual(Logic.unmappedWOs_(classified), ['W999-UNKNOWN']);

  const table1 = Logic.buildTable1_(classified);
  assert.deepStrictEqual(table1.squads, ['KSB_Elephant', 'KSB_Orca', 'KSB_Pony', 'KSB_Lead']);
  assert.strictEqual(table1.rowTotals.KSB_Elephant, 32);
  assert.strictEqual(table1.rowTotals.KSB_Orca, 40);
  assert.strictEqual(table1.rowTotals.KSB_Pony, 20);
  assert.strictEqual(table1.rowTotals.KSB_Lead, 16);
  assert.strictEqual(table1.grandTotal, 108);

  const table2 = Logic.buildTable2_(classified);
  const bySq = {};
  table2.forEach(r => { bySq[r.sq] = r; });
  assert.strictEqual(bySq.KSB_Elephant.capexPct, 0.75);
  assert.strictEqual(bySq.KSB_Orca.capexPct, 1);
  assert.strictEqual(bySq.KSB_Lead.capexPct, null);
});

process.on('exit', () => {
  if (failures > 0) {
    console.log(failures + ' failing test(s)');
    process.exitCode = 1;
  } else {
    console.log('All tests passed');
  }
});
