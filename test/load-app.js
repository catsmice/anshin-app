'use strict';
/* The app is one HTML file on purpose, so there is nothing to import. Its last
   block assigns module.exports when it runs without a document, which is what
   makes the parsers testable: pull the <script> out and run it here.

   It is wrapped in a function rather than given its own vm context, so the
   objects it returns are ordinary host objects. Across a vm realm even a plain
   array has a different Array.prototype, and assert.deepStrictEqual rejects
   it. The wrapper also keeps the app's top-level declarations out of the
   global scope, so each call gets a clean copy of its state. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..', 'taiwan-alert.html');

function loadApp() {
  const html = fs.readFileSync(APP, 'utf8');
  const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
  if (!m) throw new Error('no <script> block found in taiwan-alert.html');
  const factory = vm.runInThisContext(
    '(function (module, exports, console) {' + m[1] + '\n})',
    { filename: 'taiwan-alert.js' });
  const mod = { exports: {} };
  factory(mod, mod.exports, console);
  if (!mod.exports || !mod.exports.parseCwaTime) {
    throw new Error('the script did not export its internals');
  }
  return mod.exports;
}

module.exports = { loadApp, APP };
