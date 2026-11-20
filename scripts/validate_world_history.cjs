#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const core = require(path.join(root, 'js/world_history_core.js'));
const { stampedHtml } = require('./sync_world_history.cjs');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/world/history.json'), 'utf8'));
let checks = 0;
function check(name, run) {
  try { run(); checks++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}
const state = patch => core.normalizeState(Object.assign({caseId:'citizenship',mode:'day',date:'1868-07-28'}, patch), data);
const all = patch => core.normalizeState(Object.assign({caseId:'all',mode:'topic'}, patch), data);
const ids = s => core.visibleRecords(data, s).map(record => record.id);
const byId = id => data.records.find(record => record.id === id);

check('all requested regions have evidence-backed records, without expanding the time window', () => {
  assert.equal(data.schemaVersion, 2);
  assert.deepEqual(data.period,{startYear:1852,endYear:1868});
  assert.equal(data.records.length, 19);
  assert.equal(data.places.length, 18);
  assert.equal(data.cases.length, 3);
  const requested=['英国','法国','德国','奥匈帝国','土耳其','美国','印度','越南','智利','阿根廷','柬埔寨','老挝','韩国','朝鲜','蒙古','俄罗斯','白俄罗斯','乌克兰'];
  assert.equal(data.regions.length,requested.length+2);
  for(const name of [...requested,'中国','日本']) {
    assert(core.regionNames(data).includes(name));
    assert(data.records.some(record=>record.regions.includes(name)),name+' is only a placeholder');
  }
  for (const collection of [data.records,data.places,data.cases,data.sources,data.regions])
    assert.equal(new Set(collection.map(item=>item.id)).size,collection.length);
  for (const item of data.cases) {
    assert.equal(data.records.filter(r=>r.caseId===item.id).length,2);
    assert(core.isExactDate(item.defaultDate) && core.MODES.includes(item.defaultMode));
    assert(item.conclusion && item.boundary && item.relationType);
  }
});

check('every assertion, excerpt, date and regional entry is auditable', () => {
  const sources=new Map(data.sources.map(s=>[s.id,s]));
  for(const source of data.sources) {
    assert(core.safeSourceUrl(source.url));
    assert(source.kind && source.locator && source.checked && source.limitation);
    assert.equal(source.humanReviewed,false,'No external human expert review has occurred');
    for(const key of ['parallelUrl','witnessUrl']) if(source[key]) assert(core.safeSourceUrl(source[key]));
  }
  for(const region of data.regions) {
    assert(region.group && region.note && region.contexts.length);
    for(const context of region.contexts) assert(context.label && context.from<=context.to);
  }
  for(const record of data.records) {
    assert(record.caseId===null || data.cases.some(c=>c.id===record.caseId));
    assert(data.places.some(p=>p.id===record.placeId));
    assert(record.people.length && record.people.every(p=>p.name && p.role));
    assert(record.regions.length && record.regions.every(r=>core.regionNames(data).includes(r)));
    assert(record.placeRole && record.placeLabel && record.limitation && record.polities.length);
    assert(record.date.sourceIds.length && record.date.sourceIds.every(id=>sources.has(id)));
    assert(record.date.sortYear>=1852 && record.date.sortYear<=1868);
    if(record.date.precision==='day') assert(core.isExactDate(record.date.value));
    else if(record.date.precision==='year') assert(/^\d{4}$/.test(record.date.value));
    else { assert.equal(record.date.precision,'regnal_year'); assert.equal(record.date.value,null); }
    assert(record.claims.length>=2);
    for(const claim of [...record.claims,record.quote]) {
      assert(sources.has(claim.sourceId));
      assert(claim.locator && core.safeSourceUrl(claim.url));
    }
    assert(record.quote.text && record.quote.translation);
  }
});

check('default opens the full regional sample and retains city-level Washington clustering', () => {
  const s=core.normalizeState({},data);
  assert.equal(s.caseId,'all'); assert.equal(s.mode,'topic');
  assert.equal(ids(s).length,19);
  assert.equal(s.regions.length,20);
  const clusters=core.clusterPlaces(core.visibleRecords(data,s),data.places);
  assert.equal(clusters.length,18);
  assert.equal(clusters.find(c=>c.place.id==='washington').records.length,2);
});

check('original same-day Washington comparison still has exactly its two records', () => {
  const records=core.visibleRecords(data,state({}));
  assert.deepEqual(records.map(r=>r.id),['E3','E4']);
  assert.equal(core.clusterPlaces(records,data.places)[0].place.id,'washington');
});

check('same year does not turn 41 days into the same day', () => {
  assert.equal(core.daysBetween(byId('E1').date.value,byId('E2').date.value),41);
  assert.deepEqual(ids(state({caseId:'treaties',mode:'year',date:'1858-06-18'})),['E1','E2']);
  assert.deepEqual(ids(state({caseId:'treaties',mode:'day',date:'1858-06-18'})),['E1']);
  assert.deepEqual(ids(state({caseId:'treaties',mode:'day',date:'1858-07-29'})),['E2']);
  assert.deepEqual(ids(state({caseId:'treaties',mode:'day',date:'1858-07-01'})),[]);
});

check('unconverted regnal year never becomes an exact Gregorian year or day', () => {
  const wei=byId('E5');
  assert.equal(wei.date.value,null);
  assert.equal(wei.date.precision,'regnal_year');
  assert.equal(wei.date.sortYear,1852);
  assert.equal(core.matchesTime(wei,state({mode:'year',date:'1852-01-01'})),false);
  assert.equal(core.matchesTime(wei,state({mode:'day',date:'1852-01-01'})),false);
  assert.deepEqual(ids(state({caseId:'knowledge',mode:'topic'})),['E5','E6']);
  assert.deepEqual(ids(state({caseId:'knowledge',mode:'year',date:'1852-01-01'})),[]);
  assert.equal(core.daysBetween(null,'1868-04-06'),null);
});

check('known Gregorian year is usable in year view without inventing a day', () => {
  const record=byId('W9');
  assert.equal(record.date.precision,'year'); assert.equal(record.date.value,'1866');
  assert(core.matchesTime(record,state({mode:'year',date:'1866-01-01'})));
  assert(!core.matchesTime(record,state({mode:'day',date:'1866-01-01'})));
  assert(!core.matchesTime(record,state({mode:'day',date:'1866-10-18'})));
  const selected=all({regions:['韩国']});
  assert.equal(selected.date,'1866-01-01','Year cursor follows the selected year-level material');
  assert.deepEqual(ids(core.normalizeState({...selected,mode:'day'},data)),[]);
});

check('old Japanese calendar and nineteenth-century Russian calendar are explicit', () => {
  assert.equal(byId('E6').date.value,'1868-04-06');
  assert.deepEqual(ids(state({caseId:'knowledge',mode:'day',date:'1868-03-14'})),[]);
  for(const record of data.records.filter(r=>r.calendarConversion)) {
    const conversion=record.calendarConversion;
    assert.equal(conversion.calendar,'Julian');
    assert.equal(core.daysBetween(conversion.original,conversion.converted),conversion.offsetDays);
    assert.equal(conversion.offsetDays,12);
    assert.equal(record.date.value,conversion.converted);
  }
});

check('modern Korean entries share one Joseon record, not two invented states', () => {
  const south=ids(all({regions:['韩国']})),north=ids(all({regions:['朝鲜']}));
  assert.deepEqual(south,['W9']); assert.deepEqual(north,south);
  assert.deepEqual(ids(all({regions:['韩国','朝鲜']})),south);
  assert.equal(byId('W9').sharedPolityId,'joseon');
  assert(byId('W9').polities.includes('朝鲜王朝'));
  assert.deepEqual(core.resolveRegions(['朝祥'],data),['朝鲜']);
});

check('historical names depend on the period and do not backdate modern states', () => {
  const region=id=>data.regions.find(r=>r.id===id);
  const labels=(id,date)=>core.regionContexts(data,region(id),state({mode:'year',date})).map(c=>c.label).join(' ');
  assert.equal(labels('austria-hungary','1856-03-30'),'奥地利帝国');
  assert.equal(labels('austria-hungary','1868-01-01'),'奥匈二元君主国');
  assert(labels('germany','1856-03-30').includes('普鲁士'));
  assert(labels('germany','1868-01-01').includes('北德意志'));
  assert.equal(labels('turkey','1856-03-30'),'奥斯曼帝国');
  assert.equal(labels('russia','1861-03-03'),'俄罗斯帝国（沙皇俄国）');
  assert.deepEqual(ids(all({query:'苏联'})),[],'Future polity name must not match imperial Russia records');
});

check('regions involved are independent of event coordinates and formal treaty parties', () => {
  assert.deepEqual(ids(state({regions:['中国']})),['E3']);
  assert.equal(core.clusterPlaces(core.visibleRecords(data,state({regions:['中国']})),data.places)[0].place.id,'washington');
  assert.deepEqual(ids(all({regions:['蒙古']})),['W10']);
  assert.equal(byId('W10').placeId,'beijing');
  assert(!byId('W10').parties.includes('蒙古'));
  assert.deepEqual(byId('W6').parties,['法国','西班牙','阮朝']);
  for(const name of ['白俄罗斯','乌克兰']) assert.deepEqual(ids(all({regions:[name]})),['W11']);
  const provincialEvidence=byId('W11').claims.map(c=>c.text).join(' ');
  assert(provincialEvidence.includes('明斯克') && provincialEvidence.includes('基辅'));
});

check('region aliases and people remain searchable across the expanded catalog', () => {
  assert.deepEqual(ids(state({query:'西华德'})),['E3','E4']);
  assert.deepEqual(ids(state({query:'ＳＥＷＡＲＤ'})),['E3','E4']);
  assert.deepEqual(ids(state({query:'蒲安臣'})),['E3']);
  assert.deepEqual(ids(all({query:'奥斯曼'})),['W3']);
  assert.deepEqual(ids(all({regions:['UK','Britain','britain']})),['W3','W1','W2']);
  assert(byId('E3').people.some(p=>p.name.includes('蒲安臣')&&p.role.includes('清朝')));
});

check('Chinese side-by-side selection persists without widening map filters', () => {
  const original=all({regions:['智利'],recordId:'W12',compareId:'E1'});
  assert.deepEqual(ids(original),['W12']);
  assert.equal(original.compareId,'E1');
  assert.deepEqual(core.readState(core.writeState(original,data),data),original);
  assert.equal(all({recordId:'W12',compareId:'W13'}).compareId,null);
  assert.equal(all({recordId:'E1',compareId:'E1'}).compareId,null);
  const empty=core.normalizeState({...original,mode:'day',date:'1866-01-01'},data);
  assert.equal(empty.recordId,null); assert.equal(empty.compareId,null);
});

check('share links preserve the expanded region filter, selection and empty filters', () => {
  for(const original of [state({}),all({regions:['白俄罗斯']}),all({regions:['英国','法国'],recordId:'W3',compareId:'E1'}),
    state({caseId:'knowledge',mode:'topic',query:'魏源'}),all({regions:[],query:'华盛顿 & Seward'})])
    assert.deepEqual(core.readState(core.writeState(original,data),data),original);
});

check('malformed URL values cannot create invalid dates or unsafe sources', () => {
  assert(!core.isExactDate('1858-02-30')); assert(core.isExactDate('1868-02-29')); assert(!core.isExactDate('1858-7-1'));
  const invalid=core.readState('?case=unknown&date=1858-02-30&mode=anything&regions=火星&event=unknown&compare=unknown',data);
  assert.equal(invalid.caseId,data.defaultState.caseId); assert.equal(invalid.date,data.defaultState.date);
  assert.equal(invalid.mode,data.defaultState.mode); assert.deepEqual(invalid.regions,[]); assert.equal(invalid.recordId,null);
  assert.equal(state({date:'1900-01-01'}).date,data.defaultState.date);
  for(const unsafe of ['javascript:alert(1)','data:text/html,a','https://user:pass@example.com','not a URL']) assert.equal(core.safeSourceUrl(unsafe),null);
});

check('date relation labels respect precision instead of asserting causality', () => {
  assert.equal(core.relationLabel(byId('E3'),byId('E4')),'同日 · 文献对读');
  assert.equal(core.relationLabel(byId('E1'),byId('E2')),'同年 · 相隔41天');
  assert.equal(core.relationLabel(byId('E5'),byId('W13')),'主题对读 · 日期精度不同');
  assert.equal(core.relationLabel(byId('W9'),byId('E1')),'跨年对读 · 1866 / 1858');
});

check('view clustering expands with zoom and never changes evidence-backed places or counts', () => {
  const records=[{id:'a',placeId:'p'},{id:'b',placeId:'p'},{id:'c',placeId:'q'},{id:'d',placeId:'r'}];
  const places=[{id:'p',coordinates:[0,0]},{id:'q',coordinates:[1,0]},{id:'r',coordinates:[70,0]}];
  const before=JSON.stringify(places);
  const small=core.spatialClusters(records,places,1,1);
  assert.equal(small.length,2); assert.equal(small[0].places.length,2); assert.equal(small[0].records.length,3);
  assert.equal(core.spatialClusters(records,places,32,1).length,3);
  assert.equal(JSON.stringify(places),before);
  const actual=core.spatialClusters(data.records,data.places,1,.8);
  assert.equal(new Set(actual.flatMap(c=>c.records.map(r=>r.id))).size,19);
  assert.equal(actual.reduce((sum,c)=>sum+c.records.length,0),19);
});

check('geographic references retain sources, precision and the correct Vienna', () => {
  for(const place of data.places) {
    const [lon,lat]=place.coordinates;
    assert(Number.isFinite(lon)&&lon>=-180&&lon<=180 && Number.isFinite(lat)&&lat>=-90&&lat<=90);
    assert(['city_reference','area_reference','site_reference'].includes(place.precision));
    assert(place.note && place.coordinateLabel && core.safeSourceUrl(place.coordinateSource));
    const [x,y]=core.project(place.coordinates); assert(x>=0&&x<=1080&&y>=0&&y<=540);
  }
  const vienna=data.places.find(p=>p.id==='vienna');
  assert(vienna.coordinates[0]>16 && vienna.coordinates[0]<17 && vienna.coordinates[1]>48 && vienna.coordinates[1]<49);
  assert(vienna.coordinateSource.includes('Q1741'));
  assert.equal(data.places.find(p=>p.id==='oudong').precision,'site_reference');
});

check('narrow-screen maximum zoom and same-city events offer every record', () => {
  const records=[byId('E1'),byId('W10')];
  const grouped=core.spatialClusters(records,data.places,32,320/1080);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].places.length,2);
  assert.equal(core.clusterAction(grouped[0],32),'choose');
  assert.deepEqual(new Set(grouped[0].records.map(record=>record.id)),new Set(['E1','W10']));
  const washington=core.spatialClusters([byId('E3'),byId('E4')],data.places,1,1)[0];
  assert.equal(core.clusterAction(washington,1),'choose');
  assert.equal(core.clusterAction({places:[{}],records:[{}]},1),'select');
  assert.equal(core.clusterAction({places:[{},{}],records:[{},{}]},1),'zoom');
});

check('offline land is still the pinned, attributed dataset', () => {
  const raw=fs.readFileSync(path.join(root,'data/world/land-110m.geojson'));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),data.basemap.sha256);
  const land=JSON.parse(raw); assert.equal(land.type,'FeatureCollection'); assert.equal(land.features.length,127);
  assert.equal(data.basemap.license,'Public domain');
  for(const feature of land.features) {
    const g=feature.geometry; assert(['Polygon','MultiPolygon'].includes(g.type));
    const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
    for(const polygon of polygons) for(const ring of polygon) { assert(ring.length>=4); assert.deepEqual(ring[0],ring[ring.length-1]); for(const point of ring) assert(point.every(Number.isFinite)); }
  }
});

check('data, core and UI receive matching cache versions with local runtime assets', () => {
  const html=fs.readFileSync(path.join(root,'world.html'),'utf8');
  assert.equal(html,stampedHtml(html));
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const asset=match[1].split('?')[0]; assert(!asset.startsWith('https:'));
    assert(fs.existsSync(path.join(root,asset)),'Missing asset '+asset);
  }
  for(const file of ['js/world_history_core.js','js/world_history.js']) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
  assert(html.includes('aria-live="polite"') && html.includes('id="region-jump"') && html.includes('id="china-comparison"'));
});

console.log(`✓ World-history validation passed: ${checks} checks; ${data.records.length} records, ${data.regions.length} regions, ${data.places.length} referenced places.`);
