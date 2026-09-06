// tests/load-app.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script id="app-logic">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not find <script id="app-logic"> block in index.html');
  const code = match[1];
  const sandbox = { module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app-logic.js' });
  // Convert sandbox objects back to main context to enable deepStrictEqual comparisons
  const exports = sandbox.module.exports;
  const result = {};
  for (const key in exports) {
    const fn = exports[key];
    if (typeof fn === 'function') {
      result[key] = function(...args) {
        const ret = fn.apply(this, args);
        // Deep-convert result to main context
        return JSON.parse(JSON.stringify(ret));
      };
    }
  }
  return result;
}

module.exports = { loadApp };
