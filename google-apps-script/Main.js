// ============================================================================
// Main.js — Sheets orchestration: reads Config + WO Mapping tabs, pulls
// timesheet rows from every source spreadsheet listed in Config, combines
// them, classifies via Logic.js, and writes Table 1 / Table 2 with real
// cell colors. Everything here talks to SpreadsheetApp, so unlike Logic.js
// it can't be unit tested outside Apps Script — keep it thin, push any real
// logic decisions into Logic.js instead.
//
// To install: same script project as Logic.js, create a script file named
// "Main", paste this content in. Then reload the spreadsheet — a new
// "WO Summary" menu appears — and use "Run Now".
// ============================================================================

var CONFIG_SHEET = 'Config';
var MAPPING_SHEET = 'WO Mapping';
var RAW_SHEET = 'Combined Raw';
var TABLE1_SHEET = 'Table 1';
var TABLE2_SHEET = 'Table 2';

// Source timesheets are expected to follow the same layout as the original
// krungsri.xlsx template: data starts at row 3, column A, 36 columns wide
// (Name-Surname, SQ, WO No., WO Name, FTE/OS, then Day1..Day31). Reading
// stops at the first row where both Name and WO No. are blank — no fixed
// row-count cap, so a squad with more than 11 people works unmodified.
var TIMESHEET_START_ROW = 3;
var TIMESHEET_START_COL = 1;
var TIMESHEET_NUM_COLS = 36;
var TIMESHEET_MAX_ROWS_TO_SCAN = 2000; // safety cap against a runaway sheet

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WO Summary')
    .addItem('Run Now', 'runAll')
    .addToUi();
}

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function readConfig_(ss) {
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) {
    throw new Error('ไม่พบ tab "' + CONFIG_SHEET + '" — กรุณาสร้าง tab นี้ พร้อมหัวตาราง Squad/Label, Sheet URL, Tab Name (optional)');
  }
  var values = sheet.getDataRange().getValues();
  var rows = values.slice(1); // drop header row
  var sources = [];
  rows.forEach(function (r) {
    var label = (r[0] == null ? '' : r[0]).toString().trim();
    var url = (r[1] == null ? '' : r[1]).toString().trim();
    var tabName = (r[2] == null ? '' : r[2]).toString().trim();
    if (!url) return;
    sources.push({ label: label || url, url: url, tabName: tabName || null });
  });
  return sources;
}

function readMapping_(ss) {
  var sheet = ss.getSheetByName(MAPPING_SHEET);
  if (!sheet) {
    throw new Error('ไม่พบ tab "' + MAPPING_SHEET + '" — กรุณาสร้าง tab นี้ พร้อมหัวตาราง WO No., Category, WO Name');
  }
  var values = sheet.getDataRange().getValues();
  var rows = values.slice(1);
  return buildMappingIndex_(rows);
}

function readSourceRows_(source) {
  var srcSs;
  try {
    srcSs = SpreadsheetApp.openByUrl(source.url);
  } catch (e) {
    return { rows: [], errors: ['เปิดไฟล์ไม่ได้ (' + source.label + '): ' + e.message] };
  }

  var sheet = source.tabName ? srcSs.getSheetByName(source.tabName) : srcSs.getSheets()[0];
  if (!sheet) {
    return { rows: [], errors: ['ไม่พบ tab "' + (source.tabName || '(แรก)') + '" ในไฟล์ ' + source.label] };
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < TIMESHEET_START_ROW) return { rows: [], errors: [] };

  var rowsToScan = Math.min(lastRow - TIMESHEET_START_ROW + 1, TIMESHEET_MAX_ROWS_TO_SCAN);
  var range = sheet.getRange(TIMESHEET_START_ROW, TIMESHEET_START_COL, rowsToScan, TIMESHEET_NUM_COLS);
  var values = range.getValues();

  var rows = [];
  var errors = [];
  for (var i = 0; i < values.length; i++) {
    var raw = values[i];
    var rowNumber = TIMESHEET_START_ROW + i;
    var nameBlank = (raw[0] == null ? '' : raw[0]).toString().trim() === '';
    var woBlank = (raw[2] == null ? '' : raw[2]).toString().trim() === '';
    if (nameBlank && woBlank) break; // first fully-blank row = end of this source's data

    var parsed = parseTimesheetRow_(raw, source.label, rowNumber);
    if (parsed.ok) {
      rows.push(parsed.row);
    } else {
      errors.push(source.label + ' แถวที่ ' + rowNumber + ': ' + parsed.reason);
    }
  }
  return { rows: rows, errors: errors };
}

function writeCombinedRaw_(ss, allRows) {
  var sheet = getOrCreateSheet_(ss, RAW_SHEET);
  sheet.clear();
  var header = ['Source', 'Name-Surname', 'SQ', 'WO No.', 'WO Name', 'MH (รวม)'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#eef0f4');
  if (allRows.length === 0) return;
  var data = allRows.map(function (r) {
    return [r.source, r.name, r.sq, r.woNo, r.woName, roundMH_(r.mh)];
  });
  sheet.getRange(2, 1, data.length, header.length).setValues(data);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
}

function writeTable1_(ss, table1) {
  var sheet = getOrCreateSheet_(ss, TABLE1_SHEET);
  sheet.clear();

  var groups = [];
  table1.columns.forEach(function (col) {
    var last = groups[groups.length - 1];
    if (last && last.category === col.category) last.span++;
    else groups.push({ category: col.category, span: 1 });
  });

  var headerRow2 = ['Squad'].concat(table1.columns.map(function (c) { return c.label; }), ['Total']);
  var numCols = headerRow2.length;

  var headerRow1 = [''];
  groups.forEach(function (g) {
    headerRow1.push(CATEGORY_LABEL_[g.category]);
    for (var i = 1; i < g.span; i++) headerRow1.push('');
  });
  headerRow1.push('');

  var dataRows = table1.squads.map(function (sq) {
    var row = [sq];
    table1.columns.forEach(function (col) { row.push(roundMH_(table1.cellMatrix[sq][col.key] || 0)); });
    row.push(roundMH_(table1.rowTotals[sq]));
    return row;
  });

  var summaryRow = ['Summary'];
  table1.columns.forEach(function (col) { summaryRow.push(roundMH_(table1.colTotals[col.key])); });
  summaryRow.push(roundMH_(table1.grandTotal));

  var allRowsOut = [headerRow1, headerRow2].concat(dataRows, [summaryRow]);
  sheet.getRange(1, 1, allRowsOut.length, numCols).setValues(allRowsOut);

  // Styling: bold header band, one merged+colored cell per category group,
  // that same color washed down its data columns, and a highlighted
  // Summary row — same visual language as the web tool's Copy output.
  sheet.getRange(1, 1, 2, numCols).setFontWeight('bold');
  sheet.getRange(1, 1, 1, 1).setBackground('#eef0f4');
  sheet.getRange(2, 1, 1, 1).setBackground('#eef0f4');
  sheet.getRange(1, numCols, 1, 1).setBackground('#eef0f4');
  sheet.getRange(2, numCols, 1, 1).setBackground('#eef0f4');

  var colStart = 2;
  var totalDataRows = dataRows.length + 1; // + summary row
  var groupCol = colStart;
  groups.forEach(function (g) {
    if (g.span > 1) sheet.getRange(1, groupCol, 1, g.span).merge();
    sheet.getRange(1, groupCol, 1, g.span).setBackground(categoryBg_(g.category)).setHorizontalAlignment('center');
    sheet.getRange(2, groupCol, 1 + totalDataRows, g.span).setBackground(categoryBg_(g.category));
    groupCol += g.span;
  });

  var summaryRowIndex = 2 + dataRows.length + 1;
  sheet.getRange(summaryRowIndex, 1, 1, numCols).setFontWeight('bold').setBackground('#dde6fb');

  sheet.getRange(3, 2, dataRows.length + 1, numCols - 1).setNumberFormat('0.00');
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(1);
  sheet.autoResizeColumns(1, numCols);
}

function writeTable2_(ss, table2) {
  var sheet = getOrCreateSheet_(ss, TABLE2_SHEET);
  sheet.clear();
  var header = ['Squad', 'CAPEX MH', 'OPEX MH', 'CAPEX %', 'OPEX %'];
  var rows = table2.map(function (r) {
    return [r.sq, roundMH_(r.capexMH), roundMH_(r.opexMH), r.capexPct, r.opexPct];
  });
  var all = [header].concat(rows);
  sheet.getRange(1, 1, all.length, header.length).setValues(all);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef0f4');

  if (rows.length > 0) {
    sheet.getRange(2, 2, rows.length, 1).setBackground(categoryBg_('CAPEX')).setNumberFormat('0.00');
    sheet.getRange(2, 3, rows.length, 1).setBackground(categoryBg_('OPEX')).setNumberFormat('0.00');
    sheet.getRange(2, 4, rows.length, 1).setBackground(categoryBg_('CAPEX')).setNumberFormat('0.0%');
    sheet.getRange(2, 5, rows.length, 1).setBackground(categoryBg_('OPEX')).setNumberFormat('0.0%');
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
}

function runAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var sources;
  var mappingIndex;
  try {
    sources = readConfig_(ss);
    mappingIndex = readMapping_(ss);
  } catch (e) {
    ui.alert('ตั้งค่าไม่ครบ', e.message, ui.ButtonSet.OK);
    return;
  }

  if (sources.length === 0) {
    ui.alert('ไม่พบรายชื่อ Sheet ต้นทางใน tab "' + CONFIG_SHEET + '" กรุณาเพิ่มก่อน');
    return;
  }

  var allRows = [];
  var allErrors = [];
  sources.forEach(function (source) {
    var result = readSourceRows_(source);
    allRows = allRows.concat(result.rows);
    allErrors = allErrors.concat(result.errors);
  });

  writeCombinedRaw_(ss, allRows);

  if (allRows.length === 0) {
    ui.alert('ไม่พบข้อมูล timesheet จาก Sheet ต้นทางเลย', 'ตรวจสอบ Config และไฟล์ต้นทางอีกครั้ง' + (allErrors.length ? '\n\n' + allErrors.join('\n') : ''), ui.ButtonSet.OK);
    return;
  }

  var classifiedRows = allRows.map(function (row) { return classifyRow_(row, mappingIndex); });
  var unmappedList = unmappedWOs_(classifiedRows);

  var table1 = buildTable1_(classifiedRows);
  var table2 = buildTable2_(classifiedRows);

  writeTable1_(ss, table1);
  writeTable2_(ss, table2);

  var msg = 'รวมข้อมูลจาก ' + sources.length + ' sheet สำเร็จ (' + allRows.length + ' แถว)';
  if (unmappedList.length > 0) msg += '\n\n⚠ พบ WO No. ที่ไม่มีในตาราง Mapping:\n' + unmappedList.join(', ');
  if (allErrors.length > 0) msg += '\n\n⚠ ข้ามบางแถวที่อ่านไม่ได้:\n' + allErrors.join('\n');

  ui.alert('เสร็จแล้ว', msg, ui.ButtonSet.OK);
}
