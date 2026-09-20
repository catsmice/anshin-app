'use strict';
/* Trap cases in the shape of the responses themselves. Each test loads its own
   copy of the app, because these drive the real state object. */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./load-app.js');

const EPI = '臺東縣政府東南東方  43.0  公里 (位於臺灣東南部海域)';

function quakeRecord(opts) {
  const o = Object.assign({ no: '115000', mag: 4.0, county: '臺東縣', intensity: '3級' }, opts);
  return {
    EarthquakeNo: o.no,
    ReportContent: '地震報告',
    IssueTime: o.originTime,
    ValidTime: { EndTime: o.originTime },
    Web: 'https://example.invalid/',
    EarthquakeInfo: {
      OriginTime: o.originTime,
      FocalDepth: 10.1,
      EarthquakeMagnitude: o.noMagnitude ? undefined : { MagnitudeType: 'ML', MagnitudeValue: o.mag },
      Epicenter: { Location: EPI, EpicenterLatitude: 22.6, EpicenterLongitude: 121.5 }
    },
    Intensity: { ShakingArea: [
      { InfoStatus: 'observe', CountyName: o.county, AreaIntensity: o.intensity, AreaDesc: o.county }
    ] }
  };
}
const feed = records => ({ success: 'true', records: { Earthquake: records } });

function withQuakes(app, key, records) {
  app.state.ds[key] = { status: 'ok', data: feed(records), error: null, at: new Date() };
  app.rebuild();
}

test('E-A0016-001 reuses one EarthquakeNo, so quakes are keyed on OriginTime', () => {
  const app = loadApp();
  withQuakes(app, 'quakeSmall', [
    quakeRecord({ originTime: '2026-09-20T16:05:36+08:00', no: '115000' }),
    quakeRecord({ originTime: '2026-09-20T16:05:29+08:00', no: '115000' }),
    quakeRecord({ originTime: '2026-09-19T04:14:07+08:00', no: '115000' })
  ]);
  assert.strictEqual(app.state.quakes.length, 3,
    'three reports sharing one EarthquakeNo must stay three reports');
  assert.strictEqual(new Set(app.state.quakes.map(q => q.id)).size, 3);
});

test('quakes are returned newest first', () => {
  const app = loadApp();
  withQuakes(app, 'quakeSmall', [
    quakeRecord({ originTime: '2026-09-19T04:14:07+08:00' }),
    quakeRecord({ originTime: '2026-09-20T16:05:36+08:00' })
  ]);
  assert.ok(app.state.quakes[0].originTime > app.state.quakes[1].originTime);
});

test('the same quake in both feeds keeps the significant report', () => {
  const app = loadApp();
  const when = '2026-09-14T06:44:41+08:00';
  app.state.ds.quakeSmall = { status: 'ok', data: feed([quakeRecord({ originTime: when })]), error: null, at: new Date() };
  app.state.ds.quakeBig = { status: 'ok', data: feed([quakeRecord({ originTime: when, mag: 4.9 })]), error: null, at: new Date() };
  app.rebuild();
  assert.strictEqual(app.state.quakes.length, 1, 'one event, not two');
  assert.strictEqual(app.state.quakes[0].source, 'significant');
  assert.strictEqual(app.state.quakes[0].magnitude, 4.9);
});

test('a report with no magnitude node normalises instead of throwing', () => {
  const app = loadApp();
  withQuakes(app, 'quakeSmall', [
    quakeRecord({ originTime: '2026-09-20T16:05:36+08:00', noMagnitude: true })
  ]);
  assert.strictEqual(app.state.quakes.length, 1);
  assert.strictEqual(app.state.quakes[0].magnitude, null);
  assert.doesNotThrow(() => app.alertHeadline({
    hazardType: 'earthquake', payload: app.state.quakes[0], affectedRegions: [], regions: []
  }));
});

test('observe rows are preferred over the summary rows', () => {
  const app = loadApp();
  const rec = quakeRecord({ originTime: '2026-09-20T16:05:36+08:00' });
  rec.Intensity.ShakingArea = [
    { AreaDesc: '最大震度4級地區', CountyName: '臺東縣、花蓮縣', AreaIntensity: '4級' },
    { InfoStatus: 'observe', CountyName: '臺東縣', AreaIntensity: '2級', AreaDesc: '臺東縣' }
  ];
  withQuakes(app, 'quakeSmall', [rec]);
  const q = app.state.quakes[0];
  assert.strictEqual(q.maxIdx, app.INTENSITY_SCALE.indexOf('2級'),
    'the authoritative observe row says 2級, the summary row must not win');
  assert.strictEqual(q.shakingMeta.usedObserve, true);
});

test('summary rows are used only when a report has no observe row', () => {
  const app = loadApp();
  const rec = quakeRecord({ originTime: '2026-09-20T16:05:36+08:00' });
  rec.Intensity.ShakingArea = [
    { AreaDesc: '最大震度4級地區', CountyName: '臺東縣、花蓮縣', AreaIntensity: '4級' }
  ];
  withQuakes(app, 'quakeSmall', [rec]);
  const q = app.state.quakes[0];
  assert.strictEqual(q.shakingMeta.usedObserve, false);
  assert.strictEqual(q.maxIdx, app.INTENSITY_SCALE.indexOf('4級'));
  assert.strictEqual(q.intensityByCounty.size, 2, 'the 、-joined county list must be split');
});

/* --- W-C0033-001 always returns all 22 counties ------------------------- */

const county = (name, hazards) => ({
  locationName: name, geocode: '10000',
  hazardConditions: { hazards: hazards || [] }
});

test('a county in the response does not mean a warning in that county', () => {
  const app = loadApp();
  app.state.ds.warnCounty = {
    status: 'ok', error: null, at: new Date(),
    data: { success: 'true', records: { location: app.COUNTIES.map(c => county(c.zh)) } }
  };
  app.rebuild();
  assert.strictEqual(app.state.alerts.length, 0,
    'all 22 counties came back with empty hazards, so nothing is in force');
});

test('a county carrying a hazard produces one alert for that county', () => {
  const app = loadApp();
  const hazard = {
    info: { phenomena: '大雨', significance: '特報' },
    validTime: { startTime: '2026-09-20 16:39:00', endTime: '2026-09-21 22:00:00' }
  };
  app.state.ds.warnCounty = {
    status: 'ok', error: null, at: new Date(),
    data: { success: 'true', records: { location: app.COUNTIES.map(c =>
      county(c.zh, c.code === 'TW-HUA' ? [hazard] : [])) } }
  };
  app.rebuild();
  assert.strictEqual(app.state.alerts.length, 1);
  assert.deepStrictEqual(app.state.alerts[0].affectedRegions, ['TW-HUA']);
  assert.strictEqual(app.state.alerts[0].severity, 'warning', '大雨 is a warning tier');
});

/* --- W-C0033-002 sends contents.content as an object or an array -------- */

function narrativeFeed(content) {
  return {
    success: 'true',
    records: { record: [{
      datasetInfo: {
        issueTime: '2026-09-20 16:39:00',
        validTime: { startTime: '2026-09-20 16:39:00', endTime: '2026-09-21 22:00:00' }
      },
      contents: { content },
      hazardConditions: { hazards: { hazard: [{
        info: {
          phenomena: '大雨', significance: '特報',
          affectedAreas: { location: [{ locationName: '花蓮縣' }] }
        }
      }] } }
    }] }
  };
}
const ZH = { contentLanguage: 'zh-TW', contentText: '大雨特報內容' };

test('narrative content parses when CWA sends a bare object', () => {
  const app = loadApp();
  app.state.ds.warnText = { status: 'ok', error: null, at: new Date(), data: narrativeFeed(ZH) };
  app.rebuild();
  assert.strictEqual(app.state.alerts.length, 1);
  assert.strictEqual(app.state.alerts[0].payload.narrative.zh, '大雨特報內容');
});

test('narrative content parses when CWA sends an array', () => {
  const app = loadApp();
  app.state.ds.warnText = {
    status: 'ok', error: null, at: new Date(),
    data: narrativeFeed([ZH, { contentLanguage: 'en-US', contentText: 'Heavy rain advisory' }])
  };
  app.rebuild();
  const n = app.state.alerts[0].payload.narrative;
  assert.strictEqual(n.zh, '大雨特報內容');
  assert.strictEqual(n.en, 'Heavy rain advisory', 'official English is used where CWA supplies it');
});

test('every alert gets a readable body even with no official English', () => {
  const app = loadApp();
  app.state.ds.warnText = { status: 'ok', error: null, at: new Date(), data: narrativeFeed(ZH) };
  app.rebuild();
  const a = app.state.alerts[0];
  for (const lang of ['en', 'zh', 'ja']) {
    app.state.lang = lang;
    const body = app.alertBody(a);
    assert.ok(body && body.length > 20, `${lang} body should be written from the structured fields`);
    assert.ok(!/undefined|NaN|\{\w+\}/.test(body), `${lang} body has an unfilled slot: ${body}`);
  }
});
