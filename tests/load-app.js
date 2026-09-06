// tests/load-app.js
const fs = require('fs');
const path = require('path');

function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script id="app-logic">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not find <script id="app-logic"> block in index.html');
  const code = match[1];
  const module = { exports: {} };
  const run = new Function('module', 'exports', code);
  run(module, module.exports);
  return module.exports;
}

module.exports = { loadApp };
