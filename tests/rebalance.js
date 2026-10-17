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

process.on('exit', () => {
  if (failures > 0) { console.log(failures + ' failing test(s)'); process.exitCode = 1; }
  else { console.log('All rebalance tests passed'); }
});
