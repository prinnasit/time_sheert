const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const requiredIds = [
  'mapping-grid', 'mapping-add-row-btn', 'mapping-input', 'clear-mapping-btn', 'mapping-status',
  'timesheet-grid', 'timesheet-add-row-btn', 'timesheet-input', 'xlsx-upload', 'upload-status',
  'run-btn', 'banners',
  'table1-container', 'copy-table1-btn', 'download-table1-btn',
  'table2-container', 'copy-table2-btn', 'download-table2-btn'
];

const missing = requiredIds.filter(id => !html.includes('id="' + id + '"'));

if (missing.length > 0) {
  console.log('FAIL - missing element ids: ' + missing.join(', '));
  process.exitCode = 1;
} else {
  console.log('ok - all required element ids present');
}
