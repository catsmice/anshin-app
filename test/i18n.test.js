'use strict';
/* Adding a language is a data change, so the thing that can go wrong is a
   half-finished table. These read the shipped file and fail on any gap. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { loadApp, APP } = require('./load-app.js');

const src = fs.readFileSync(APP, 'utf8');
const app = loadApp();
const STRING = "'(?:[^'\\\\]|\\\\.)*'";

/* Languages the picker offers, minus English which is the fallback itself. */
const LANGS = [...src.matchAll(/\['([a-z]{2})','[^']+'\]/g)].map(m => m[1]);

test('the language picker offers the languages it should', () => {
  assert.deepStrictEqual(LANGS, ['en', 'zh', 'ja', 'id', 'vi']);
});

test('every language has a date locale', () => {
  const locale = src.match(/const LOCALE = \{([^}]*)\}/)[1];
  for (const lang of LANGS) {
    assert.ok(new RegExp('\\b' + lang + ':').test(locale), `LOCALE has no entry for ${lang}`);
  }
});

test('every UI string exists in every language', () => {
  const block = src.match(/const STR = \{([\s\S]*?)\n\};/)[1];
  const entry = new RegExp('\\b([A-Za-z0-9_]+):\\{((?:' + STRING + '|[^\'{}])*)\\}', 'g');
  const gaps = [];
  for (const m of block.matchAll(entry)) {
    const [, key, body] = m;
    if (!/\ben:/.test(body)) continue;
    for (const lang of LANGS) {
      if (lang !== 'en' && !new RegExp('\\b' + lang + ":'").test(body)) gaps.push(`${key}.${lang}`);
    }
  }
  assert.deepStrictEqual(gaps, [], `untranslated strings: ${gaps.join(', ')}`);
});

test('every county is named in every language', () => {
  for (const c of app.COUNTIES) {
    for (const lang of LANGS) {
      assert.ok(c[lang], `${c.code} has no ${lang} name`);
    }
  }
});

test('safety guidance exists in every language', () => {
  const guidance = src.match(/const GUIDANCE = \{([\s\S]*?)\n\};/)[1];
  // categories are written both on one line and across several, so slice
  // each one from its own header to the next rather than matching a shape
  const heads = [...guidance.matchAll(/\n  ([a-z]+):\s*\{/g)];
  assert.ok(heads.length >= 8, `expected at least eight guidance categories, found ${heads.length}`);
  for (let i = 0; i < heads.length; i++) {
    const cat = heads[i][1];
    const body = guidance.slice(heads[i].index,
      i + 1 < heads.length ? heads[i + 1].index : guidance.length);
    for (const lang of LANGS) {
      assert.ok(new RegExp('\\b' + lang + ':\\[').test(body),
        `guidance "${cat}" has nothing in ${lang}, and this is the safety text`);
    }
  }
});

test('every language has a full ten-tier intensity scale', () => {
  const table = src.match(/const INTENSITY_LABEL = \{([\s\S]*?)\n\};/)[1];
  for (const lang of LANGS) {
    const row = table.match(new RegExp('\\b' + lang + ": \\[([^\\]]*)\\]"));
    assert.ok(row, `INTENSITY_LABEL has no ${lang} row, and two views index it directly`);
    assert.strictEqual(row[1].split(',').length, 10, `${lang} intensity scale is not ten tiers`);
  }
});
