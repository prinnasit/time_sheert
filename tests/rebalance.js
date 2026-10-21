// tests/rebalance.js — OPEX rebalance: pure helpers + planner + apply.
const assert = require('assert');
const { loadApp } = require('./load-app');
const { settingsRoleCeilingRows } = require('./fixtures');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); }
  catch (err) { failures++; console.log('  FAIL - ' + name); console.log('    ' + err.message); }
}

const App = loadApp();

test('parseRoleCeilings reads the sample ceilings (strings -> numbers)', () => {
  const parsed = App.parseRoleCeilings(settingsRoleCeilingRows);
  assert.deepStrictEqual(parsed.skipped, []);
  assert.deepStrictEqual(parsed.map['developer'], { role: 'Developer', z: 2, capex: 16, opex: 2 });
  assert.deepStrictEqual(parsed.map['quality assurance lead'], { role: 'Quality Assurance Lead', z: 8, capex: 9.6, opex: 2.4 });
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

test('timesheetToTSV gives one tab-separated line per row, no header, every column kept', () => {
  const row = ['A', 'S', 'W1', 'n', 'FTE', '8', '', '0.5'].concat(new Array(28).fill(''));
  const tsv = App.timesheetToTSV([row, ['=cmd', 'S'].concat(new Array(34).fill(''))]);
  const lines = tsv.split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].split('\t').length, 36);
  assert.deepStrictEqual(lines[0].split('\t').slice(0, 8), ['A', 'S', 'W1', 'n', 'FTE', '8', '', '0.5']);
  assert.ok(!tsv.includes('Name-Surname'), 'must not include the header row');
  assert.strictEqual(lines[1].split('\t')[0], "'=cmd"); // formula guard, same as Copy/CSV
});

test('squadSummary pairs each squad\'s CAPEX/OPEX % before and after, in the after table\'s order', () => {
  const after = [{ sq: 'S1', capexPct: 0.2, opexPct: 0.8 }, { sq: 'S2', capexPct: 0.5, opexPct: 0.5 }];
  const before = [{ sq: 'S2', capexPct: 0.5, opexPct: 0.5 }, { sq: 'S1', capexPct: 0.1, opexPct: 0.9 }];
  const s = App.squadSummary(after, before);
  assert.deepStrictEqual(s.header, ['Squad', 'CAPEX % (เดิม)', 'CAPEX % (ใหม่)', 'OPEX % (เดิม)', 'OPEX % (ใหม่)']);
  assert.deepStrictEqual(s.rows, [['S1', 0.1, 0.2, 0.9, 0.8], ['S2', 0.5, 0.5, 0.5, 0.5]]);
  assert.deepStrictEqual(App.squadSummary([{ sq: 'S3', capexPct: 1, opexPct: 0 }], []).rows, [['S3', null, 1, null, 0]]);
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
const ceilings = App.parseRoleCeilings(settingsRoleCeilingRows).map;
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

// ---- applyMoves / summarizeRows --------------------------
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

test('summarizeRows runs parse → classify → Table 1/2 on grid rows', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8 }), row('Dev1', 'S1', 'O1', { 2: 8 })];
  const s = App.summarizeRows(rows, mapping);
  assert.strictEqual(s.parsed.rows.length, 2);
  assert.strictEqual(s.table2[0].opexPct, 0.5);
  assert.strictEqual(s.table1.grandTotal, 2);
});

// ---- review-follow-up tests ------------------------------------------------

test('fractional cells: unit = min(1, cell), daily totals unchanged, no negative cell', () => {
  // C1: day1 = 8 (8 MH). O1: days 3-10 = 8 each (64) + day 11 = 0.5 + day 12 = 0.25 -> O = 64.75, T = 72.75.
  // Needs O <= 58.2 -> move >= 6.55 MH. Latest day first: 0.25 (day 12), 0.5 (day 11), then 1 MH from day 10 x6 = 6.75 total.
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8 }), row('Dev1', 'S1', 'O1', days(3, 10, 8, { 11: 0.5, 12: 0.25 }))];
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1')]));
  assert.deepStrictEqual(plan.moves.map(m => m.mh), [0.25, 0.5, 1, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(plan.moves.map(m => m.day), [12, 11, 10, 10, 10, 10, 10, 10]);
  assert.strictEqual(plan.squads[0].status, 'fixed');
  const after = App.applyMoves(rows, plan.moves);
  assert.deepStrictEqual(dayTotals(after), dayTotals(rows));
  after.forEach(r => { for (let d = 0; d < 31; d++) assert.ok((Number(r[5 + d]) || 0) >= 0, 'negative cell'); });
});

test('Remaining shared by two people on one CAPEX WO never goes below 0', () => {
  // Two devs, each C1 day1 = 8 and O1 days 3-10 (64): squad needs ~13 MH moved, but C1 has
  // last = 2 MD used + 0.625 MD (= 5 MH) of budget and there is no other CAPEX WO.
  const rows = [
    row('DevA', 'S1', 'C1', { 1: 8 }), row('DevA', 'S1', 'O1', days(3, 10, 8)),
    row('DevB', 'S1', 'C1', { 1: 8 }), row('DevB', 'S1', 'O1', days(3, 10, 8))
  ];
  const last = 2.625;
  const plan = App.planRebalance(ctxFor(rows, [DEV('DevA'), DEV('DevB')], { remainingLast: { C1: last } }));
  const moved = plan.moves.reduce((a, m) => a + m.mh, 0);
  const used = 2; // MD already booked on C1 (16 MH)
  assert.ok(used + moved / 8 <= last + 1e-9, 'C1 remaining went negative');
  assert.strictEqual(moved, 5);
  assert.ok(plan.squads[0].afterPct > 0.8);
});

test('21 working days scales ceilings x1.05 (round 1 stops earlier than at 20 days)', () => {
  // dev4Rows: O = 18 MH. Developer OPEX ceiling = 2 MD * 1.05 * 8 = 16.8 MH -> excess 1.2.
  // Unit 1 fits (<= 1.2) -> excess 0.2; the next unit (1 MH, day 4 now holds 1) exceeds 0.2 -> refused. 1 move
  // (at 20 days the ceiling is 16 and two units move).
  const plan = App.planRebalance(ctxFor(dev4Rows(), [DEV('Dev4')], { workingDays: 21 }));
  assert.strictEqual(plan.moves.length, 1);
  assert.strictEqual(plan.moves[0].round, 1);
  assert.strictEqual(plan.squads[0].status, 'needs-continue');
});

test('a person in two squads is reported for the over squad even when their first squad is fine', () => {
  const rows = [row('Carol', 'SQ1', 'C1', { 1: 8 }), row('Carol', 'SQ2', 'O1', { 1: 8 })];
  const plan = App.planRebalance(ctxFor(rows, [DEV('Carol')]), { includeRound2: true });
  assert.strictEqual(plan.squads.find(s => s.sq === 'SQ2').status, 'unresolvable');
  assert.strictEqual(plan.moves.length, 0);
  assert.deepStrictEqual(plan.skipped, [{ name: 'Carol', sq: 'SQ2', reason: 'อยู่หลาย squad' }]);
});

test('a fixed squad re-plans to zero moves after applyMoves (idempotent)', () => {
  const rows = [row('Dev1', 'S1', 'C1', { 1: 8, 2: 8 }), row('Dev1', 'S1', 'O1', days(3, 11, 8))];
  const plan = App.planRebalance(ctxFor(rows, [DEV('Dev1')]));
  assert.strictEqual(plan.squads[0].status, 'fixed');
  const after = App.applyMoves(rows, plan.moves);
  const again = App.planRebalance(ctxFor(after, [DEV('Dev1')]));
  assert.strictEqual(again.moves.length, 0);
  assert.strictEqual(again.squads[0].status, 'ok');
});

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

process.on('exit', () => {
  if (failures > 0) { console.log(failures + ' failing test(s)'); process.exitCode = 1; }
  else { console.log('All rebalance tests passed'); }
});
