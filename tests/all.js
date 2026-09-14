// tests/all.js — runs every test file in this folder in sequence and exits
// non-zero if any of them failed. Usage: node tests/all.js
const { execFileSync } = require('child_process');
const path = require('path');

const files = ['check-structure.js', 'run-tests.js', 'edge-cases.js', 'e2e.js'];

let anyFailed = false;
files.forEach(file => {
  console.log('\n=== ' + file + ' ===');
  try {
    const output = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
    process.stdout.write(output);
  } catch (err) {
    anyFailed = true;
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
  }
});

console.log('\n' + (anyFailed ? 'SOME TEST FILES FAILED' : 'ALL TEST FILES PASSED'));
process.exitCode = anyFailed ? 1 : 0;
