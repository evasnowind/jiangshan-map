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

check('requested regions have evidence-backed records throughout the expanded time frame', () => {
  assert.equal(data.schemaVersion, 4);
  assert.deepEqual(data.period,{startYear:-10,endYear:2000});
  assert(data.records.length >= 60);
  assert(data.places.length >= 18);
  assert(data.cases.length >= 3);
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
    if(record.placeId===null) assert(record.locationStatus==='unlocated' && record.locationNote);
    else assert(data.places.some(p=>p.id===record.placeId));
    assert(Array.isArray(record.people) && record.people.every(p=>p.name && p.role));
    assert(record.regions.length && record.regions.every(r=>core.regionNames(data).includes(r)));
    assert(record.placeRole && record.placeLabel && record.limitation && record.polities.length);
    assert(record.date.sourceIds.length && record.date.sourceIds.every(id=>sources.has(id)));
    assert(record.date.sortYear>=-10 && record.date.sortYear<=2000 && record.date.sortYear!==0);
    if(record.date.precision==='day') { assert(core.isExactDate(record.date.value)); assert.equal(core.yearOfDate(record.date.value),record.date.sortYear); }
    else if(record.date.precision==='year') { assert(/^-?\d{4}$/.test(record.date.value) && core.yearOfDate(record.date.value)!==null); assert.equal(core.yearOfDate(record.date.value),record.date.sortYear); }
    else if(record.date.precision==='range') {
      assert.equal(record.date.value,null);
      assert(Number.isInteger(record.date.fromYear) && record.date.fromYear!==0 && record.date.fromYear>=-10);
      assert(Number.isInteger(record.date.toYear) && record.date.toYear!==0 && record.date.toYear<=2000);
      assert(record.date.fromYear<=record.date.toYear);
      assert.equal(record.date.sortYear,record.date.fromYear);
      assert(record.date.original);
    } else { assert.equal(record.date.precision,'regnal_year'); assert.equal(record.date.value,null); }
    assert(record.claims.length>=1);
    for(const claim of [...record.claims,record.quote]) {
      assert(sources.has(claim.sourceId));
      assert(claim.locator && core.safeSourceUrl(claim.url));
    }
    assert(record.quote.text && record.quote.translation);
    assert(['primary_text','catalog_description','research_report'].includes(record.quote.kind || 'primary_text'));
  }
});

check('default opens the full regional sample and retains city-level Washington clustering', () => {
  const s=core.normalizeState({},data);
  assert.equal(s.caseId,'all'); assert.equal(s.mode,'topic');
  assert.equal(ids(s).length,data.records.length);
  assert.equal(s.regions.length,20);
  const clusters=core.clusterPlaces(core.visibleRecords(data,s),data.places);
  assert.equal(clusters.length,data.places.filter(p=>data.records.some(r=>r.placeId===p.id)).length);
  assert(clusters.find(c=>c.place.id==='washington').records.some(r=>r.id==='E3'));
  assert(clusters.find(c=>c.place.id==='washington').records.some(r=>r.id==='E4'));
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
  const selected=all({regions:['韩国'],recordId:'W9'});
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
    if (['W10','W11'].includes(record.id)) assert.equal(conversion.offsetDays,12);
    assert.equal(record.date.value,conversion.converted);
  }
});

check('modern Korean entries share one Joseon record, not two invented states', () => {
  const south=ids(all({regions:['韩国']})),north=ids(all({regions:['朝鲜']}));
  assert(south.includes('W9') && north.includes('W9'));
  const pre1948=s=>s.filter(id=>byId(id).date.sortYear<1948);
  assert.deepEqual(pre1948(north),pre1948(south));
  assert.equal(new Set(ids(all({regions:['韩国','朝鲜']}))).size,ids(all({regions:['韩国','朝鲜']})).length);
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
  const soviet=ids(all({query:'苏联'}));
  assert(soviet.length>0); assert(!soviet.includes('W11'),'Soviet name must not match imperial emancipation');
});

check('regions involved are independent of event coordinates and formal treaty parties', () => {
  assert.deepEqual(ids(state({regions:['中国']})),['E3']);
  assert.equal(core.clusterPlaces(core.visibleRecords(data,state({regions:['中国']})),data.places)[0].place.id,'washington');
  assert(ids(all({regions:['蒙古']})).includes('W10'));
  assert.equal(byId('W10').placeId,'beijing');
  assert(!byId('W10').parties.includes('蒙古'));
  assert.deepEqual(byId('W6').parties,['法国','西班牙','阮朝']);
  for(const name of ['白俄罗斯','乌克兰']) assert(ids(all({regions:[name]})).includes('W11'));
  const provincialEvidence=byId('W11').claims.map(c=>c.text).join(' ');
  assert(provincialEvidence.includes('明斯克') && provincialEvidence.includes('基辅'));
});

check('region aliases and people remain searchable across the expanded catalog', () => {
  assert.deepEqual(ids(state({query:'西华德'})),['E3','E4']);
  assert.deepEqual(ids(state({query:'ＳＥＷＡＲＤ'})),['E3','E4']);
  assert.deepEqual(ids(state({query:'蒲安臣'})),['E3']);
  assert(ids(all({query:'奥斯曼'})).includes('W3'));
  assert.deepEqual(core.resolveRegions(['UK','Britain','britain'],data),['英国']);
  for(const id of ['W3','W1','W2']) assert(ids(all({regions:['英国']})).includes(id));
  assert(byId('E3').people.some(p=>p.name.includes('蒲安臣')&&p.role.includes('清朝')));
});

check('Chinese side-by-side selection persists without widening map filters', () => {
  const original=all({regions:['智利'],recordId:'W12',compareId:'E1'});
  assert(ids(original).includes('W12'));
  assert(core.visibleRecords(data,original).every(record=>record.regions.includes('智利')));
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
  assert.equal(state({date:'2001-01-01'}).date,data.defaultState.date);
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
  assert.equal(new Set(actual.flatMap(c=>c.records.map(r=>r.id))).size,data.records.filter(r=>r.placeId!==null).length);
  assert.equal(actual.reduce((sum,c)=>sum+c.records.length,0),data.records.filter(r=>r.placeId!==null).length);
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

check('BCE/CE navigation has no year zero and dates do not use the JS 1900 offset', () => {
  assert.equal(core.indexToYear(core.yearToIndex(-1)+1),1);
  assert.equal(core.indexToYear(core.yearToIndex(1)-1),-1);
  const years=[];
  for(let index=core.yearToIndex(-10);index<=core.yearToIndex(2000);index++) years.push(core.indexToYear(index));
  assert.equal(years.length,2010); assert(!years.includes(0));
  for(const year of years) assert.equal(core.indexToYear(core.yearToIndex(year)),year);
  assert.equal(core.yearOfDate('-0010-01-01'),-10);
  assert.equal(core.yearOfDate('0002'),2);
  assert(!core.isExactDate('0000-01-01')); assert(!core.isExactDate('-0000-01-01'));
  assert(core.isExactDate('0004-02-29')); assert(!core.isExactDate('0001-02-29'));
  assert(core.isExactDate('-0001-02-29')); // Astronomical year 0 in the proleptic calendar.
  assert.equal(core.daysBetween('-0001-12-31','0001-01-01'),1);
  // The independent standard UTC implementation is only an oracle, never the production year parser.
  function utc(value) {
    const date=new Date(0), year=core.yearOfDate(value);
    date.setUTCFullYear(year<0?year+1:year,Number(value.slice(-5,-3))-1,Number(value.slice(-2)));
    date.setUTCHours(0,0,0,0); return date.getTime()/86400000;
  }
  for(let index=core.yearToIndex(-10);index<core.yearToIndex(2000);index++) {
    const a=core.yearValue(core.indexToYear(index))+'-01-01', b=core.yearValue(core.indexToYear(index+1))+'-01-01';
    assert.equal(core.daysBetween(a,b),utc(b)-utc(a));
  }
  assert.equal(core.daysBetween('0099-12-31','0100-01-01'),1);
  assert.equal(core.daysBetween('1900-02-28','1900-03-01'),1);
  assert.equal(core.daysBetween('2000-02-28','2000-03-01'),2);
  assert.equal(core.dateForYear(1900,'2000-02-29'),'1900-02-28');
  assert.equal(core.formatYear(-10),'公元前10年');
  assert.equal(core.formatDate('0002-01-01'),'公元2年1月1日');
  assert.equal(state({date:'-0011-01-01'}).date,data.defaultState.date);
  assert.equal(state({date:'0000-01-01'}).date,data.defaultState.date);
});

check('epochs partition the requested 2010 historical years without fabricating coverage', () => {
  assert.equal(data.eras.length,7);
  assert.equal(data.coverage.complete,false);
  assert(data.coverage.gaps.length>0);
  for(const gap of data.coverage.gaps) { assert(gap.label && gap.reason); for(const url of gap.urls) assert(core.safeSourceUrl(url)); }
  const years=[];
  for(const era of data.eras) {
    assert(era.label && era.caption && era.id);
    for(let index=core.yearToIndex(era.from);index<=core.yearToIndex(era.to);index++) years.push(core.indexToYear(index));
    const scoped=all({eraId:era.id});
    assert(ids(scoped).length>0,era.id+' has no real material');
    assert(core.visibleRecords(data,scoped).every(r=>core.overlapsYears(r,era.from,era.to)));
    assert.deepEqual(core.readState(core.writeState(scoped,data),data),scoped);
  }
  assert.equal(years.length,2010); assert.equal(new Set(years).size,2010);
  const bce=data.records.find(r=>r.date.sortYear===-10);
  assert(bce && bce.date.precision==='regnal_year' && bce.date.value===null);
  assert(!core.matchesTime(bce,{mode:'year',date:'-0010-06-01'},data));
  const yearWitness={...bce,date:{value:'-0010',precision:'year',sortYear:-10}};
  assert(core.matchesTime(yearWitness,{mode:'year',date:'-0010-06-01'},data));
  assert(!core.matchesTime(bce,{mode:'day',date:'-0010-01-01'},data));
  const end=data.records.find(r=>r.id==='MX1');
  assert.equal(end.date.value,'2000-10-10');
  const s=all({eraId:'ancient',recordId:bce.id,compareId:'E1'});
  assert(!ids(s).includes('E1')); assert.equal(s.compareId,'E1');
  assert.deepEqual(core.readState(core.writeState(s,data),data),s);
});

check('every epoch offers an evidence-backed Chinese counterpart', () => {
  for(const era of data.eras) {
    const selected=all({eraId:era.id,regions:['中国']});
    const records=core.visibleRecords(data,selected);
    assert(records.length>0,era.id+' has no Chinese counterpart');
    assert(records.every(record=>record.regions.includes('中国')));
  }
  const qing=ids(all({query:'清朝'}));
  assert(qing.includes('CX1')); assert(!qing.includes('CX2') && !qing.includes('MX1'));
  const census=data.cases.find(item=>item.id==='counting');
  assert(census && census.defaultMode==='topic');
  assert.deepEqual(data.records.filter(record=>record.caseId==='counting').map(record=>record.id),['AX2','EX1']);
  assert.equal(byId('AX2').date.value,null);
  assert.equal(byId('EX1').date.value,'0014');
  assert.equal(byId('EX1').statistics.value,4937000);
  assert(byId('EX1').placeRole.includes('传本'));
});

check('date ranges never become exact-year or exact-day facts', () => {
  const range={id:'TEST-RANGE',caseId:null,regions:['中国'],title:'范围测试',summary:'',people:[],placeId:null,date:{value:null,precision:'range',fromYear:450,toYear:550,sortYear:450}};
  assert(!core.matchesTime(range,{mode:'year',date:'0500-01-01'},data));
  assert(core.matchesTime(range,{mode:'year',date:'0500-01-01',includeRanges:true},data));
  for(const year of [450,550]) assert(core.matchesTime(range,{mode:'year',date:core.yearValue(year)+'-01-01',includeRanges:true},data));
  for(const year of [449,551]) assert(!core.matchesTime(range,{mode:'year',date:core.yearValue(year)+'-01-01',includeRanges:true},data));
  assert(!core.matchesTime(range,{mode:'day',date:'0500-01-01',includeRanges:true},data));
  assert(!core.matchesTime({...range,date:{...range.date,fromYear:-1,toYear:1}},{mode:'year',date:'0000-01-01',includeRanges:true},data));
  const fixture={...data,records:[...data.records,range]};
  const s=core.normalizeState({caseId:'all',mode:'topic',eraId:'medieval-early',recordId:range.id,includeRanges:true},fixture);
  assert.equal(s.date,'0501-01-01','The cursor uses the intersecting epoch, not a fabricated midpoint');
  assert.equal(range.date.value,null);
  assert.deepEqual(core.readState(core.writeState(s,fixture),fixture),s);
  assert.equal(core.readState('?case=all&mode=year&date=0500-01-01&ranges=on',fixture).includeRanges,false);
  assert.equal(core.readState('?case=all&mode=year&date=0500-01-01&ranges=1',fixture).includeRanges,true);
});

check('range ranking respects intersection, distance and the missing year zero', () => {
  const r=(from,to)=>({date:{precision:'range',value:null,fromYear:from,toYear:to,sortYear:from}});
  const y=year=>({date:{precision:'year',value:core.yearValue(year),sortYear:year}});
  assert.equal(core.temporalDistance(r(970,1020),y(1000)),0);
  assert.equal(core.temporalDistance(r(970,1020),r(1010,1100)),0);
  assert.equal(core.temporalDistance(r(970,1020),y(1041)),21);
  assert.equal(core.temporalDistance(y(-1),y(1)),1);
  assert.equal(core.relationLabel(r(970,1020),y(1000)),'年代范围相交 · 同期尚不确定');
  assert.equal(core.relationLabel(r(970,1020),y(1041)),'范围对读 · 年代不重叠');
});

check('coverage distinguishes anchored material, intersecting ranges and empty cells', () => {
  const fixture={regions:[{id:'china',name:'中国'},{id:'usa',name:'美国'}],eras:[{id:'a',from:1,to:500},{id:'b',from:501,to:1000}],records:[
    {regions:['中国'],date:{precision:'range',value:null,fromYear:450,toYear:550,sortYear:450}},
    {regions:['美国'],date:{precision:'year',value:'0500',sortYear:500}}
  ]};
  const rows=core.coverageMatrix(fixture);
  assert.deepEqual(rows.map(row=>row.cells.map(c=>[c.anchoredCount,c.rangeCount])),[[[0,1],[0,1]],[[1,0],[0,0]]]);
  const actual=core.coverageMatrix(data).flatMap(row=>row.cells);
  assert.equal(actual.length,140);
  assert(actual.filter(cell=>cell.anchoredCount).length>74,'New fixed/dated material must fill previous gaps');
  assert(actual.some(cell=>cell.rangeCount));
  assert.equal(data.coverage.complete,false);
  assert.deepEqual(data.period,{startYear:-10,endYear:2000});
});

check('unlocated material stays readable without acquiring a fabricated map point', () => {
  const unlocated=data.records.filter(record=>record.placeId===null);
  assert(unlocated.length>0);
  for(const record of unlocated) {
    assert.equal(record.locationStatus,'unlocated'); assert(record.locationNote);
    assert.equal(core.clusterPlaces([record],data.places).length,0);
  }
  const clustered=core.clusterPlaces(data.records,data.places).flatMap(cluster=>cluster.records);
  assert.equal(new Set(clustered.map(record=>record.id)).size,data.records.length-unlocated.length);
});

check('curated Chinese reading guides link evidence and state the comparison boundary', () => {
  assert(data.readingGuides.length>=3);
  for(const guide of data.readingGuides) {
    assert(guide.title && guide.question && guide.reading && guide.boundary && guide.relationBasis);
    const china=byId(guide.chinaRecordId),other=byId(guide.otherRecordId);
    assert(china && other && china.id!==other.id && china.regions.includes('中国'));
    assert(guide.sourceIds.length>=2 && guide.sourceIds.every(id=>data.sources.some(source=>source.id===id)));
    const s=all({recordId:other.id,compareId:china.id});
    assert.equal(s.compareId,china.id);
    assert.deepEqual(core.readState(core.writeState(s,data),data),s);
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
