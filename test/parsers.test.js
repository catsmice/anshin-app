'use strict';
/* These cover the CWA field traps listed in the README. Each one is a case
   where the feed looks reasonable and quietly means something else. */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./load-app.js');

const app = loadApp();

/* --- timestamps: two formats, one of them with no offset ---------------- */

test('space-separated CWA times are Asia/Taipei, not UTC', () => {
  assert.strictEqual(
    app.parseCwaTime('2026-09-20 05:00:00').toISOString(),
    '2026-09-19T21:00:00.000Z',
    'W-C0033-* times carry no offset; read as UTC they land eight hours out');
});

test('ISO times keep the offset CWA sent', () => {
  assert.strictEqual(
    app.parseCwaTime('2026-09-19T14:00:00+08:00').toISOString(),
    '2026-09-19T06:00:00.000Z');
});

test('unparseable times are null rather than Invalid Date', () => {
  assert.strictEqual(app.parseCwaTime(''), null);
  assert.strictEqual(app.parseCwaTime(null), null);
  assert.strictEqual(app.parseCwaTime('not a time'), null);
});

/* --- intensity: ten tiers, two suffixes, never sorted as text ----------- */

test('intensity is an ordinal over all ten tiers', () => {
  const scale = app.INTENSITY_SCALE;
  assert.strictEqual(scale.length, 10);
  for (let i = 1; i < scale.length; i++) {
    assert.ok(app.intensityIndex(scale[i]) > app.intensityIndex(scale[i - 1]),
      `${scale[i]} must outrank ${scale[i - 1]}`);
  }
  assert.ok(app.intensityIndex('5弱') > app.intensityIndex('4級'));
});

test('a locale-aware sort of the scale is wrong in Japanese', () => {
  const scale = app.INTENSITY_SCALE;
  if (!(typeof Intl !== 'undefined' && Intl.Collator.supportedLocalesOf(['ja-JP']).length)) {
    return;  // a small-ICU build cannot show the difference
  }
  // A code-unit sort happens to agree with the real order, which is the trap:
  // it looks safe until someone sorts with the locale the UI already uses.
  const ja = [...scale].sort((a, b) => a.localeCompare(b, 'ja-JP'));
  assert.notDeepStrictEqual(ja, scale, 'ja-JP collation should disagree with the real order');
  assert.ok(ja.indexOf('5強') < ja.indexOf('5弱'),
    'ja-JP puts 5強 before 5弱, which would rank stronger shaking as weaker');
});

test('an unknown intensity string does not masquerade as tier 0', () => {
  assert.strictEqual(app.intensityIndex('8級'), -1);
  assert.strictEqual(app.intensityIndex(''), -1);
});

/* --- numbers: strings in typhoon data, numbers in earthquake data ------- */

test('numeric fields are coerced from either type', () => {
  assert.strictEqual(app.num('970'), 970);
  assert.strictEqual(app.num('33'), 33);
  assert.strictEqual(app.num(4.9), 4.9);
  assert.strictEqual(app.num(null), null);
  assert.strictEqual(app.num('n/a'), null);
});

/* --- county names: CWA writes 臺, prose writes 台 ------------------------ */

test('both 臺 and 台 spellings resolve to the same county', () => {
  assert.strictEqual(app.resolveRegion('臺東縣').code, 'TW-TTT');
  assert.strictEqual(app.resolveRegion('台東縣').code, 'TW-TTT');
  assert.strictEqual(app.resolveRegion('臺北市').code, 'TW-TPE');
});

test('恆春半島 maps up to Pingtung', () => {
  assert.strictEqual(app.resolveRegion('恆春半島').code, 'TW-PIF');
});

test('a sub-county descriptor resolves to no county but is still named', () => {
  const r = app.resolveRegion('山區');
  assert.strictEqual(r.code, null, 'mountain areas are not a county');
  assert.strictEqual(r.sub, '山區', 'and must not vanish from the UI');
});

/* --- epicenter: parsed out of one fixed Chinese pattern ----------------- */

test('epicenter distance is measured from the county government office', () => {
  const p = app.parseEpicenter('臺東縣政府東南東方  43.0  公里 (位於臺灣東南部海域)');
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.en, '43.0 km ESE of Taitung County Hall, off southeastern Taiwan');
  assert.strictEqual(p.parts.distanceKm, 43);
  assert.strictEqual(p.parts.countyCode, 'TW-TTT');
});

test('the parenthetical is dropped when it repeats the county already named', () => {
  const p = app.parseEpicenter('花蓮縣政府南方  3.2  公里 (位於花蓮縣近海)');
  assert.strictEqual(p.en, '3.2 km S of Hualien County Hall, offshore');
  assert.ok(!/Hualien.*Hualien/.test(p.en), 'Hualien must not be named twice');
});

test('Japanese renders place names in shinjitai', () => {
  const p = app.parseEpicenter('花蓮縣政府南方  3.2  公里 (位於花蓮縣近海)');
  assert.ok(p.ja.includes('花蓮県庁'), `expected 県庁 in ${p.ja}`);
  assert.ok(!p.ja.includes('縣'), 'traditional 縣 should be folded to 県');
});

test('an unrecognised epicenter string is returned rather than dropped', () => {
  const p = app.parseEpicenter('某個沒見過的描述');
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.zh, '某個沒見過的描述');
});

/* --- severity is computed here, never read from CWA --------------------- */

test('earthquake severity follows maximum observed intensity', () => {
  const at = v => app.INTENSITY_SCALE.indexOf(v);
  assert.strictEqual(app.quakeSeverity(at('5弱'), '').sev, 'severe');
  assert.strictEqual(app.quakeSeverity(at('6強'), '').sev, 'severe');
  assert.strictEqual(app.quakeSeverity(at('4級'), '').sev, 'warning');
  assert.strictEqual(app.quakeSeverity(at('3級'), '').sev, 'advisory');
  assert.strictEqual(app.quakeSeverity(at('0級'), '').sev, 'advisory');
});

test('a tsunami warning outranks the shaking, and the routine note does not', () => {
  assert.strictEqual(app.quakeSeverity(0, '此地震發布海嘯警報').sev, 'severe');
  assert.strictEqual(app.quakeSeverity(0, '沿海地區請注意，不會有海嘯').sev, 'advisory',
    'the standard "no tsunami" sentence must not trigger a severe tier');
});

test('weather severity follows the phenomenon, and the unknown case is never info', () => {
  assert.strictEqual(app.weatherSeverity('豪雨').sev, 'severe');
  assert.strictEqual(app.weatherSeverity('大豪雨').sev, 'severe');
  assert.strictEqual(app.weatherSeverity('大雨').sev, 'warning');
  assert.strictEqual(app.weatherSeverity('濃霧').sev, 'advisory');
  assert.strictEqual(app.weatherSeverity('火山特報').sev, 'advisory',
    'an unrecognised warning must not render as calm');
});

test('severity carries the rule and inputs it was computed from', () => {
  const s = app.weatherSeverity('豪雨');
  assert.ok(s.rule, 'the proof panel needs the rule');
  assert.ok(Array.isArray(s.inputs) && s.inputs.length, 'and the inputs it ran on');
});

/* --- geography ---------------------------------------------------------- */

test('distance to Taiwan is measured to the nearest county, not a centroid', () => {
  const tokyo = app.distanceToTaiwan(35.68, 139.65);
  assert.ok(tokyo.km > 1500, `Tokyo should be far away, got ${tokyo.km}`);
  const offHualien = app.distanceToTaiwan(23.9, 121.8);
  assert.ok(offHualien.km < 60, `just off Hualien should be close, got ${offHualien.km}`);
  assert.strictEqual(offHualien.nearest, 'TW-HUA');
});

test('every county in the lookup has geometry, and every shape has a county', () => {
  const geo = new Set(app.TW_GEO.features.map(f => f.properties.code));
  const list = new Set(app.COUNTIES.map(c => c.code));
  assert.strictEqual(list.size, 22);
  for (const code of list) assert.ok(geo.has(code), `${code} has no shape to draw`);
  for (const code of geo) assert.ok(list.has(code), `${code} is drawn but not in the county table`);
});

test('the projection squeezes longitude by cos(latitude)', () => {
  const proj = app.makeProjection({ minLon: 119, maxLon: 122, minLat: 21.8, maxLat: 25.4 }, 400, 400, 10);
  assert.ok(proj.X(122) > proj.X(119), 'east is to the right');
  assert.ok(proj.Y(25.4) < proj.Y(21.8), 'north is up');
  const oneDegLon = proj.X(121) - proj.X(120);
  const oneDegLat = proj.Y(23) - proj.Y(24);
  assert.ok(oneDegLon < oneDegLat, 'a degree of longitude is shorter than one of latitude here');
});

/* --- adding a language must stay a data change ------------------------- */

test('an unsupported language falls back to English and never to Chinese', () => {
  const fresh = loadApp();
  fresh.state.lang = 'xx';
  const han = /[一-鿿]/;
  const samples = {
    county: fresh.countyLabel('TW-HUA'),
    severity: fresh.t('sev.severe'),
    status: fresh.t('statusClear', { c: fresh.countyLabel('TW-TPE') }),
    headline: fresh.alertHeadline({
      hazardType: 'weather', payload: { phenomena: '大雨' },
      affectedRegions: ['TW-HUA'], regions: []
    })
  };
  for (const [what, value] of Object.entries(samples)) {
    assert.ok(value, `${what} produced nothing`);
    assert.ok(!han.test(value),
      `${what} fell back to Chinese for an unknown language: ${value}`);
  }
});
