// tests/edge-cases.js — deeper edge-case coverage beyond the core
// happy-path tests in run-tests.js: unusual input, boundary values,
// negative numbers, duplicate data, unicode, and export escaping.
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

// -- parseNum / parseDataRows -------------------------------------------

test('parseNum accepts negative numbers and thousands separators', () => {
  assert.deepStrictEqual(App.parseNum('-8'), { ok: true, value: -8 });
  assert.deepStrictEqual(App.parseNum('1,234'), { ok: true, value: 1234 });
  assert.deepStrictEqual(App.parseNum('-1,234.5'), { ok: true, value: -1234.5 });
});

test('parseNum treats whitespace-only or blank as zero, not an error', () => {
  assert.deepStrictEqual(App.parseNum(''), { ok: true, value: 0 });
  assert.deepStrictEqual(App.parseNum('   '), { ok: true, value: 0 });
  assert.deepStrictEqual(App.parseNum(null), { ok: true, value: 0 });
  assert.deepStrictEqual(App.parseNum(undefined), { ok: true, value: 0 });
});

test('parseNum rejects genuinely non-numeric text', () => {
  assert.strictEqual(App.parseNum('8hrs').ok, false);
  assert.strictEqual(App.parseNum('N/A').ok, false);
  assert.strictEqual(App.parseNum('ลา').ok, false);
});

test('parseDataRows accepts a row with negative MH (a correction entry)', () => {
  const row = ['Alice', 'SQ1', 'CAPEX-001', 'MVP1', '1', '-4', '8'];
  const result = App.parseDataRows([row]);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].mh, 4);
});

test('parseDataRows treats a row with only 5 columns (no daily cells at all) as zero MH, not an error', () => {
  const row = ['Alice', 'SQ1', 'CAPEX-001', 'MVP1', '1'];
  const result = App.parseDataRows([row]);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].mh, 0);
  assert.strictEqual(result.skippedRows.length, 0);
});

test('parseDataRows ignores extra columns beyond Day31 rather than erroring', () => {
  const row = ['Alice', 'SQ1', 'CAPEX-001', 'MVP1', '1'].concat(new Array(31).fill('1')).concat(['garbage', 'more garbage']);
  const result = App.parseDataRows([row]);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].mh, 31);
});

test('parseDataRows handles Unicode names (Thai) without corruption', () => {
  const row = ['สมชาย ใจดี', 'ทีม A', 'CAPEX-001', 'งานหลัก', '1', '8'];
  const result = App.parseDataRows([row]);
  assert.strictEqual(result.rows[0].name, 'สมชาย ใจดี');
  assert.strictEqual(result.rows[0].sq, 'ทีม A');
  assert.strictEqual(result.rows[0].woName, 'งานหลัก');
});

// -- parseMappingText / classifyRows -------------------------------------

test('parseMappingText: a duplicate WO No. with two categories has the LAST one win, and is reported in duplicateWOs', () => {
  const result = App.parseMappingText('CAPEX-001\tCAPEX\tFirst\nCAPEX-001\tOPEX\tSecond');
  assert.strictEqual(result.map['CAPEX-001'].category, 'OPEX');
  assert.strictEqual(result.map['CAPEX-001'].name, 'Second');
  assert.deepStrictEqual(result.duplicateWOs, ['CAPEX-001']);
});

test('parseMappingText: a duplicate WO No. written with different casing is still detected (normalized key)', () => {
  const result = App.parseMappingText('capex-001\tCAPEX\tFirst\nCAPEX-001\tCAPEX\tSecond');
  assert.deepStrictEqual(result.duplicateWOs, ['CAPEX-001']);
});

test('parseMappingText: no false positives — distinct WO Nos never appear in duplicateWOs', () => {
  const result = App.parseMappingText('CAPEX-001\tCAPEX\tOne\nCAPEX-002\tCAPEX\tTwo');
  assert.deepStrictEqual(result.duplicateWOs, []);
});

test('classifyRows matches WO No. case-insensitively against the mapping', () => {
  const mapping = App.parseMappingText('capex-001\tCAPEX\tMVP1');
  const rows = [{ rowNumber: 1, name: 'A', sq: 'SQ1', woNo: 'CAPEX-001', woName: '', mh: 8 }];
  const result = App.classifyRows(rows, mapping);
  assert.strictEqual(result.rows[0].category, 'CAPEX');
});

test('classifyRows: two differently-cased writings of the same unmapped WO both land in the same column (buildTable1), even though the unmapped-list itself is not case-deduped', () => {
  const mapping = App.parseMappingText('');
  const rows = [
    { rowNumber: 1, name: 'A', sq: 'SQ1', woNo: 'w999', woName: 'x', mh: 8 },
    { rowNumber: 2, name: 'B', sq: 'SQ1', woNo: 'W999', woName: 'y', mh: 8 }
  ];
  const result = App.classifyRows(rows, mapping);
  const table1 = App.buildTable1(result.rows);
  assert.strictEqual(table1.columns.length, 1); // merged into one column regardless of case
  assert.strictEqual(table1.colTotals[table1.columns[0].key], 2); // (8+8)/8 Man-Day
  // Known limitation: unmappedWOs is not case-deduped (documents current behavior).
  assert.strictEqual(result.unmappedWOs.length, 2);
});

test('classifyRows never defaults an unrecognized category to CAPEX — unmapped stays unmapped even with a garbled mapping row', () => {
  const mapping = App.parseMappingText('CAPEX-001\tnot-a-real-category\tMVP1');
  const rows = [{ rowNumber: 1, name: 'A', sq: 'SQ1', woNo: 'CAPEX-001', woName: '', mh: 8 }];
  const result = App.classifyRows(rows, mapping);
  assert.strictEqual(result.rows[0].category, 'UNMAPPED');
});

// -- buildTable1 / buildTable2 boundary cases -----------------------------

test('buildTable1 on an empty input returns empty structures, not an error', () => {
  const table = App.buildTable1([]);
  assert.deepStrictEqual(table.squads, []);
  assert.deepStrictEqual(table.columns, []);
  assert.strictEqual(table.grandTotal, 0);
});

test('buildTable2 on an empty input returns an empty array', () => {
  assert.deepStrictEqual(App.buildTable2([]), []);
});

test('buildTable1 Man-Day conversion handles negative totals (overspent/correction) correctly', () => {
  const classified = [{ sq: 'SQ1', woKey: 'C1', woLabel: 'C1', woNo: 'C1', category: 'CAPEX', mh: -16 }];
  const table = App.buildTable1(classified);
  assert.strictEqual(table.cellMatrix.SQ1.C1, -2);
  assert.strictEqual(table.grandTotal, -2);
});

test('buildTable2 with only Non-Charge/Unmapped rows for a squad: both percentages are null (nothing chargeable), not 0/0 or NaN', () => {
  const classified = [{ sq: 'SQ1', category: 'NON_CHARGE', mh: 40 }];
  const table = App.buildTable2(classified);
  assert.strictEqual(table[0].capexPct, null);
  assert.strictEqual(table[0].opexPct, null);
});

test('buildTable1 sort places a completely non-numeric WO No. deterministically without throwing', () => {
  const classified = [
    { sq: 'SQ1', woKey: 'ABC', woLabel: 'Abc', woNo: 'ABC', category: 'CAPEX', mh: 8 },
    { sq: 'SQ1', woKey: 'CAPEX-001', woLabel: 'One', woNo: 'CAPEX-001', category: 'CAPEX', mh: 8 }
  ];
  const table = App.buildTable1(classified);
  assert.strictEqual(table.columns.length, 2);
  assert.deepStrictEqual(table.columns.map(c => c.woNo).sort(), ['ABC', 'CAPEX-001'].sort());
});

// -- formatMH / formatPct boundary cases ----------------------------------

test('formatMH handles negative, zero, and near-integer values correctly', () => {
  assert.strictEqual(App.formatMH(-2.5), '-2.50');
  assert.strictEqual(App.formatMH(0), '0.00');
  assert.strictEqual(App.formatMH(-0), '0.00');
});

test('formatPct handles 0% (not treated as null) and 100%', () => {
  assert.strictEqual(App.formatPct(0), '0.00%');
  assert.strictEqual(App.formatPct(1), '100.00%');
});

// -- CSV / TSV export escaping --------------------------------------------

test('toCSV correctly quotes a value containing only a newline (RFC 4180)', () => {
  const csv = App.toCSV(['A'], [['line1\nline2']]);
  assert.strictEqual(csv, 'A\r\n"line1\nline2"');
});

test('toCSV handles Unicode (Thai) text without corruption or unnecessary quoting', () => {
  const csv = App.toCSV(['ชื่อ'], [['สมชาย ใจดี']]);
  assert.strictEqual(csv, 'ชื่อ\r\nสมชาย ใจดี');
});

test('neutralizeFormula guards =, +, @ but leaves numbers and plain text untouched', () => {
  assert.strictEqual(App.neutralizeFormula('=1+1'), "'=1+1");
  assert.strictEqual(App.neutralizeFormula('+SUM(A1)'), "'+SUM(A1)");
  assert.strictEqual(App.neutralizeFormula('@cmd'), "'@cmd");
  assert.strictEqual(App.neutralizeFormula('ONE Corporate MVP1'), 'ONE Corporate MVP1');
  assert.strictEqual(App.neutralizeFormula(-5), -5); // a real number is never touched
  assert.strictEqual(App.neutralizeFormula('-5'), '-5'); // a numeric-looking string starting with "-" is not a trigger char
});

test('toCSV/toTSV neutralize a formula-injection attempt in a text cell (e.g. a WO Name)', () => {
  assert.strictEqual(App.toCSV(['WO Name'], [["=cmd|'/c calc'!A1"]]), "WO Name\r\n'=cmd|'/c calc'!A1");
  assert.strictEqual(App.toTSV(['WO Name'], [['+SUM(A1:A9)']]), "WO Name\n'+SUM(A1:A9)");
});

test('toCSV/toTSV do NOT mangle a legitimate negative Man-Day number (regression guard)', () => {
  assert.strictEqual(App.toCSV(['Total'], [[-12.5]]), 'Total\r\n-12.5');
  assert.strictEqual(App.toTSV(['Total'], [[-12.5]]), 'Total\n-12.5');
});

test('toTSV neutralizes embedded tabs so pasted columns cannot shift', () => {
  const tsv = App.toTSV(['A', 'B'], [['x\ty', 'z']]);
  assert.strictEqual(tsv, 'A\tB\nx y\tz');
});

test('splitPasteBlock handles a single cell with no delimiters at all', () => {
  assert.deepStrictEqual(App.splitPasteBlock('justonecell'), [['justonecell']]);
});

test('splitPasteBlock handles an empty string without throwing', () => {
  assert.deepStrictEqual(App.splitPasteBlock(''), [['']]);
});

test('splitPasteBlock preserves an intentionally blank line in the middle of a block', () => {
  assert.deepStrictEqual(App.splitPasteBlock('a\tb\n\nc\td'), [['a', 'b'], [''], ['c', 'd']]);
});

// -- table1ToRows / table2ToRows full pipeline with UNMAPPED-only data ----

test('table1ToRows/table2ToRows produce a well-formed export even when every row is UNMAPPED', () => {
  const mapping = App.parseMappingText('');
  const rows = [{ rowNumber: 1, name: 'A', sq: 'SQ1', woNo: 'X1', woName: 'Mystery', mh: 8 }];
  const classified = App.classifyRows(rows, mapping);
  const table1 = App.buildTable1(classified.rows);
  const table2 = App.buildTable2(classified.rows);
  const t1rows = App.table1ToRows(table1);
  const t2rows = App.table2ToRows(table2);
  assert.strictEqual(t1rows.header[1], 'X1');
  assert.deepStrictEqual(t2rows.header, ['Squad', 'CAPEX %', 'OPEX %']);
  // UNMAPPED MH counts toward neither CAPEX nor OPEX, so there's nothing
  // chargeable for this squad — both percentages export as empty (null).
  assert.strictEqual(t2rows.rows[0][1], '');
  assert.strictEqual(t2rows.rows[0][2], '');
});

process.on('exit', () => {
  if (failures > 0) {
    console.log(failures + ' failing test(s)');
    process.exitCode = 1;
  } else {
    console.log('All edge-case tests passed');
  }
});
