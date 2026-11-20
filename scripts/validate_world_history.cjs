#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const core = require(path.join(root, 'js/world_history_core.js'));
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/world/history.json'), 'utf8'));
let checks = 0;
function check(name, run) {
  try { run(); checks++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}
const state = patch => core.normalizeState(Object.assign({}, data.defaultState, patch), data);
const ids = s => core.visibleRecords(data, s).map(record => record.id);
const byId = id => data.records.find(record => record.id === id);

check('bounded research sample with stable identities', () => {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.records.length, 6);
  assert.equal(data.places.length, 5);
  assert.equal(data.cases.length, 3);
  for (const collection of [data.records, data.places, data.cases, data.sources])
    assert.equal(new Set(collection.map(item => item.id)).size, collection.length);
  for (const item of data.cases) {
    assert.equal(data.records.filter(r => r.caseId === item.id).length, 2);
    assert(core.isExactDate(item.defaultDate));
    assert(core.MODES.includes(item.defaultMode));
    assert(item.conclusion && item.boundary && item.relationType);
  }
});

check('every assertion, excerpt and date points to locatable evidence', () => {
  const sources = new Map(data.sources.map(s => [s.id, s]));
  for (const source of data.sources) {
    assert(core.safeSourceUrl(source.url));
    assert(source.kind && source.locator && source.checked && source.limitation);
    assert.equal(typeof source.humanReviewed, 'boolean');
    // No third-party review occurred during this research pass.
    assert.equal(source.humanReviewed, false);
  }
  for (const record of data.records) {
    assert(data.cases.some(c => c.id === record.caseId));
    assert(data.places.some(p => p.id === record.placeId));
    assert(record.people.length && record.people.every(person => person.name && person.role));
    assert(record.regions.length && record.regions.every(r => core.REGIONS.includes(r)));
    assert(record.placeRole && record.placeLabel && record.limitation);
    assert(record.date.sourceIds.length && record.date.sourceIds.every(id => sources.has(id)));
    assert(record.claims.length >= 2);
    for (const claim of [...record.claims, record.quote]) {
      assert(sources.has(claim.sourceId));
      assert(claim.locator && core.safeSourceUrl(claim.url));
    }
    assert(record.quote.text && record.quote.translation);
  }
});

check('default opens two same-day Washington records at one cluster', () => {
  const s = state({});
  assert.deepEqual(ids(s), ['E3', 'E4']);
  const clusters = core.clusterPlaces(core.visibleRecords(data,s), data.places);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].place.id, 'washington');
  assert.equal(clusters[0].records.length, 2);
});

check('same year does not turn 41 days into the same day', () => {
  assert.equal(core.daysBetween(byId('E1').date.value, byId('E2').date.value), 41);
  assert.deepEqual(ids(state({ caseId:'treaties',mode:'year',date:'1858-06-18' })), ['E1','E2']);
  assert.deepEqual(ids(state({ caseId:'treaties',mode:'day',date:'1858-06-18' })), ['E1']);
  assert.deepEqual(ids(state({ caseId:'treaties',mode:'day',date:'1858-07-29' })), ['E2']);
  assert.deepEqual(ids(state({ caseId:'treaties',mode:'day',date:'1858-07-01' })), []);
});

check('uncertain regnal year never becomes an exact Gregorian year or day', () => {
  const wei = byId('E5');
  assert.equal(wei.date.value, null);
  assert.equal(wei.date.precision, 'regnal_year');
  assert.equal(wei.date.sortYear, 1852);
  assert.equal(core.matchesTime(wei, state({ mode:'year',date:'1852-01-01' })), false);
  assert.equal(core.matchesTime(wei, state({ mode:'day',date:'1852-01-01' })), false);
  assert.deepEqual(ids(state({ caseId:'knowledge',mode:'topic' })), ['E5','E6']);
  assert.deepEqual(ids(state({ caseId:'knowledge',mode:'year',date:'1852-01-01' })), []);
  assert.equal(core.daysBetween(null, '1868-04-06'), null);
});

check('old Japanese calendar is not confused with Gregorian March 14', () => {
  assert.equal(byId('E6').date.value, '1868-04-06');
  assert.deepEqual(ids(state({ caseId:'knowledge',mode:'day',date:'1868-03-14' })), []);
  assert.deepEqual(ids(state({ caseId:'knowledge',mode:'day',date:'1868-04-06' })), ['E6']);
});

check('involved regions are independent of event coordinates', () => {
  const s = state({ regions:['中国'] });
  assert.deepEqual(ids(s), ['E3']);
  assert.equal(core.clusterPlaces(core.visibleRecords(data,s),data.places)[0].place.id,'washington');
  assert.deepEqual(ids(state({ regions:[] })), []);
  assert.deepEqual(ids(state({ regions:['日本'] })), []);
});

check('people, roles and aliases are searchable without changing their historical side', () => {
  assert.deepEqual(ids(state({ query:'西华德' })), ['E3','E4']);
  assert.deepEqual(ids(state({ query:'ＳＥＷＡＲＤ' })), ['E3','E4']);
  assert.deepEqual(ids(state({ query:'蒲安臣' })), ['E3']);
  assert.deepEqual(ids(state({ caseId:'knowledge',mode:'topic',query:'魏源' })), ['E5']);
  assert(byId('E3').people.some(p => p.name.includes('蒲安臣') && p.role.includes('清朝')));
});

check('share URLs preserve query, time precision and even an intentionally empty region filter', () => {
  for (const original of [state({}), state({caseId:'knowledge',mode:'topic',query:'魏源'}),
    state({regions:[],query:'华盛顿 & Seward'}),state({caseId:'all',mode:'year',date:'1858-07-29',regions:['中国']})]) {
    assert.deepEqual(core.readState(core.writeState(original),data), original);
  }
});

check('malformed URL values cannot create invalid time or source URLs', () => {
  assert.equal(core.isExactDate('1858-02-30'), false);
  assert.equal(core.isExactDate('1868-02-29'), true);
  assert.equal(core.isExactDate('1858-7-1'), false);
  const invalid = core.readState('?case=unknown&date=1858-02-30&mode=anything&regions=火星',data);
  assert.equal(invalid.caseId,data.defaultState.caseId);
  assert.equal(invalid.date,data.defaultState.date);
  assert.equal(invalid.mode,data.defaultState.mode);
  assert.deepEqual(invalid.regions,[]);
  assert.equal(state({date:'1900-01-01'}).date,data.defaultState.date);
  for (const unsafe of ['javascript:alert(1)','data:text/html,a','https://user:pass@example.com','not a URL'])
    assert.equal(core.safeSourceUrl(unsafe),null);
});

check('geographic reference points carry a source and explicit precision', () => {
  for (const place of data.places) {
    const [lon,lat] = place.coordinates;
    assert(Number.isFinite(lon) && lon >= -180 && lon <= 180);
    assert(Number.isFinite(lat) && lat >= -90 && lat <= 90);
    assert(['city_reference','area_reference'].includes(place.precision));
    assert(place.note && place.coordinateLabel && core.safeSourceUrl(place.coordinateSource));
    const [x,y] = core.project(place.coordinates);
    assert(x>=0 && x<=1080 && y>=0 && y<=540);
  }
  assert.equal(data.places.find(p=>p.id==='edo-bay').precision,'area_reference');
  assert(data.places.find(p=>p.id==='edo-bay').bounds.length===4);
  assert.equal(data.records.filter(r=>r.date.precision==='day').length,5);
});

check('offline land geometry matches the pinned, attributed dataset', () => {
  const raw = fs.readFileSync(path.join(root,'data/world/land-110m.geojson'));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),data.basemap.sha256);
  const land = JSON.parse(raw);
  assert.equal(land.type,'FeatureCollection');
  assert.equal(land.features.length,127);
  assert.equal(data.basemap.license,'Public domain');
  for (const feature of land.features) {
    const g=feature.geometry;
    assert(['Polygon','MultiPolygon'].includes(g.type));
    const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
    for(const polygon of polygons) for(const ring of polygon) {
      assert(ring.length>=4);
      assert.deepEqual(ring[0],ring[ring.length-1]);
      for (const point of ring) assert(point.every(Number.isFinite));
    }
  }
});

check('page dependencies are local and JavaScript parses on Node 20+', () => {
  const html=fs.readFileSync(path.join(root,'world.html'),'utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const asset=match[1];
    assert(!asset.startsWith('https:'),'Runtime assets must remain local');
    assert(fs.existsSync(path.join(root,asset)),'Missing asset '+asset);
  }
  for(const file of ['js/world_history_core.js','js/world_history.js'])
    new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
  assert(html.includes('aria-live="polite"'));
  assert(html.includes('href="./"'));
});

console.log(`✓ World-history validation passed: ${checks} checks; 6 records, 3 comparisons, 5 referenced places.`);
