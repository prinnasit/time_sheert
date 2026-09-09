// ============================================================================
// Logic.js — pure classification logic, no SpreadsheetApp calls.
//
// This is the Apps Script counterpart of index.html's <script id="app-logic">
// block: same category rules, same cross-tab/percent-table algorithm, ported
// from "parse pasted TSV text" to "read a 2D array straight out of a Sheets
// Range". Kept dependency-free and DOM/Sheets-free so it can be unit tested
// with plain Node (see tests/run-tests.js) before you ever paste it in.
//
// To install: open Extensions > Apps Script on your master Google Sheet,
// create a script file named "Logic", and paste this entire file's content
// into it. Apps Script's V8 runtime supports this syntax as-is.
// ============================================================================

function normalizeWO_(s) {
  return String(s == null ? '' : s).trim().toUpperCase();
}

function normalizeCategory_(s) {
  var key = String(s == null ? '' : s).trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (key === 'CAPEX') return 'CAPEX';
  if (key === 'OPEX') return 'OPEX';
  if (key === 'NONCHARGE' || key === 'NONCHARGEABLE' || key === 'NONCHARGABLE') return 'NON_CHARGE';
  return null;
}

var CATEGORY_ORDER_ = ['CAPEX', 'OPEX', 'NON_CHARGE', 'UNMAPPED'];
var CATEGORY_LABEL_ = { CAPEX: 'CAPEX', OPEX: 'OPEX', NON_CHARGE: 'Non Charge', UNMAPPED: '⚠ Unmapped' };
var CATEGORY_BG_ = { CAPEX: '#d7f2df', OPEX: '#d8e8fc', NON_CHARGE: '#fdf0cf', UNMAPPED: '#fbdcdc' };

function categoryBg_(cat) {
  return CATEGORY_BG_[cat] || '#ffffff';
}

// mappingRows: array of [woNo, category, woName] (e.g. from a Sheets Range,
// header row already stripped). Rows with a blank WO No. or an unrecognized
// category are silently skipped — same "never silently default" contract as
// the web tool: an unrecognized category just means that WO stays out of the
// index, so it surfaces later as UNMAPPED rather than being miscategorized.
function buildMappingIndex_(mappingRows) {
  var map = {};
  (mappingRows || []).forEach(function (r) {
    var woNo = (r[0] == null ? '' : r[0]).toString().trim();
    var category = normalizeCategory_(r[1]);
    var woName = (r[2] == null ? '' : r[2]).toString().trim();
    if (!woNo || !category) return;
    map[normalizeWO_(woNo)] = { wo: woNo, category: category, name: woName };
  });
  return map;
}

function parseNum_(v) {
  if (v == null || v === '') return { ok: true, value: 0 };
  if (typeof v === 'number') return { ok: true, value: v };
  var n = Number(String(v).trim().replace(/,/g, ''));
  return isNaN(n) ? { ok: false, value: 0 } : { ok: true, value: n };
}

// row: [Name, SQ, WoNo, WoName, FTE, day1..day31] — same 36-column layout as
// the web tool's timesheet input. Returns { ok:false, reason } for a row that
// can't be used (caller decides whether that's an error or end-of-data).
function parseTimesheetRow_(row, sourceLabel, rowNumber) {
  if (!row || row.length < 5) return { ok: false, reason: 'row too short' };
  var name = (row[0] == null ? '' : row[0]).toString().trim();
  var sq = (row[1] == null ? '' : row[1]).toString().trim() || '(Unspecified)';
  var woNo = (row[2] == null ? '' : row[2]).toString().trim();
  var woName = (row[3] == null ? '' : row[3]).toString().trim();
  if (!woNo) return { ok: false, reason: 'missing WO No.' };
  var daily = row.slice(5, 36);
  var mh = 0;
  for (var i = 0; i < daily.length; i++) {
    var parsed = parseNum_(daily[i]);
    if (!parsed.ok) return { ok: false, reason: 'non-numeric MH at day ' + (i + 1) };
    mh += parsed.value;
  }
  return { ok: true, row: { source: sourceLabel, rowNumber: rowNumber, name: name, sq: sq, woNo: woNo, woName: woName, mh: mh } };
}

function classifyRow_(row, mappingIndex) {
  var key = normalizeWO_(row.woNo);
  var entry = mappingIndex[key];
  var category = entry ? entry.category : 'UNMAPPED';
  var woLabel = (entry && entry.name) || row.woName || row.woNo;
  var out = {};
  for (var k in row) out[k] = row[k];
  out.category = category;
  out.woKey = key;
  out.woLabel = woLabel;
  return out;
}

function unmappedWOs_(classifiedRows) {
  var seen = {};
  classifiedRows.forEach(function (row) {
    if (row.category === 'UNMAPPED') seen[row.woNo] = true;
  });
  return Object.keys(seen);
}

function buildTable1_(classifiedRows) {
  var squads = [];
  var squadSeen = {};
  classifiedRows.forEach(function (row) {
    if (!squadSeen[row.sq]) { squadSeen[row.sq] = true; squads.push(row.sq); }
  });

  var columns = [];
  var colSeen = {};
  CATEGORY_ORDER_.forEach(function (cat) {
    classifiedRows.forEach(function (row) {
      if (row.category !== cat || colSeen[row.woKey]) return;
      colSeen[row.woKey] = true;
      columns.push({ key: row.woKey, label: row.woLabel, category: cat });
    });
  });

  var cellMatrix = {};
  squads.forEach(function (sq) { cellMatrix[sq] = {}; });
  classifiedRows.forEach(function (row) {
    cellMatrix[row.sq][row.woKey] = (cellMatrix[row.sq][row.woKey] || 0) + row.mh;
  });

  var rowTotals = {};
  squads.forEach(function (sq) {
    var t = 0;
    columns.forEach(function (c) { t += cellMatrix[sq][c.key] || 0; });
    rowTotals[sq] = t;
  });

  var colTotals = {};
  columns.forEach(function (c) {
    var t = 0;
    squads.forEach(function (sq) { t += cellMatrix[sq][c.key] || 0; });
    colTotals[c.key] = t;
  });

  var grandTotal = 0;
  squads.forEach(function (sq) { grandTotal += rowTotals[sq]; });

  return { squads: squads, columns: columns, cellMatrix: cellMatrix, rowTotals: rowTotals, colTotals: colTotals, grandTotal: grandTotal };
}

function buildTable2_(classifiedRows) {
  var order = [];
  var seen = {};
  var capex = {};
  var opex = {};
  classifiedRows.forEach(function (row) {
    if (!seen[row.sq]) { seen[row.sq] = true; order.push(row.sq); capex[row.sq] = 0; opex[row.sq] = 0; }
    if (row.category === 'CAPEX') capex[row.sq] += row.mh;
    if (row.category === 'OPEX') opex[row.sq] += row.mh;
  });
  return order.map(function (sq) {
    var c = capex[sq], o = opex[sq];
    var chargeable = c + o;
    return {
      sq: sq,
      capexMH: c,
      opexMH: o,
      capexPct: chargeable > 0 ? c / chargeable : null,
      opexPct: chargeable > 0 ? o / chargeable : null
    };
  });
}

// Rounds for display (Sheets cells hold real numbers + a number format, so
// unlike the web tool there's no separate "full precision for export" vs
// "rounded for display" split — this rounding IS what lands in the cell,
// with the cell's NumberFormat controlling how it's shown).
function roundMH_(n) {
  return Math.round(n * 100) / 100;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeWO_: normalizeWO_,
    normalizeCategory_: normalizeCategory_,
    CATEGORY_ORDER_: CATEGORY_ORDER_,
    CATEGORY_LABEL_: CATEGORY_LABEL_,
    CATEGORY_BG_: CATEGORY_BG_,
    categoryBg_: categoryBg_,
    buildMappingIndex_: buildMappingIndex_,
    parseNum_: parseNum_,
    parseTimesheetRow_: parseTimesheetRow_,
    classifyRow_: classifyRow_,
    unmappedWOs_: unmappedWOs_,
    buildTable1_: buildTable1_,
    buildTable2_: buildTable2_,
    roundMH_: roundMH_
  };
}
