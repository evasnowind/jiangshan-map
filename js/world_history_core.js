/* Shared, dependency-free time and evidence rules for the world-history reader. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorldHistoryCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = ['day', 'year', 'topic'];
  const REGIONS = ['中国', '日本', '美国'];

  function isExactDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeState(input, data) {
    const defaults = data.defaultState;
    const caseId = input.caseId === 'all' || data.cases.some(c => c.id === input.caseId)
      ? input.caseId : defaults.caseId;
    const date = isExactDate(input.date) && Number(input.date.slice(0, 4)) >= data.period.startYear &&
      Number(input.date.slice(0, 4)) <= data.period.endYear ? input.date : defaults.date;
    const regions = Array.isArray(input.regions)
      ? REGIONS.filter(region => input.regions.includes(region)) : REGIONS.slice();
    return {
      caseId,
      mode: MODES.includes(input.mode) ? input.mode : defaults.mode,
      date,
      regions,
      query: typeof input.query === 'string' ? input.query.slice(0, 120) : ''
    };
  }

  function readState(search, data) {
    const params = new URLSearchParams(search);
    return normalizeState({
      caseId: params.get('case'), mode: params.get('mode'), date: params.get('date'),
      regions: params.has('regions') ? params.get('regions').split(',') : undefined,
      query: params.get('q')
    }, data);
  }

  function writeState(state) {
    const params = new URLSearchParams({ case: state.caseId, mode: state.mode, date: state.date });
    if (state.regions.length !== REGIONS.length) params.set('regions', state.regions.join(','));
    if (state.query.trim()) params.set('q', state.query.trim());
    return '?' + params.toString();
  }

  function matchesTime(record, state) {
    if (state.mode === 'topic') return true;
    // A regnal year is not an inferred Gregorian year, month or day.
    if (record.date.precision !== 'day' || !isExactDate(record.date.value)) return false;
    return state.mode === 'day' ? record.date.value === state.date
      : record.date.value.slice(0, 4) === state.date.slice(0, 4);
  }

  function normalizeText(text) { return text.normalize('NFKC').toLocaleLowerCase(); }

  function matchesFilters(record, state) {
    if (!record.regions.some(region => state.regions.includes(region))) return false;
    const query = normalizeText(state.query.trim());
    if (!query) return true;
    return normalizeText([
      record.title, record.placeLabel, record.summary, record.regions.join(' '),
      ...(record.aliases || []), ...record.people.map(p => p.name + ' ' + p.role)
    ].join(' ')).includes(query);
  }

  function visibleRecords(data, state) {
    return data.records.filter(record => (state.caseId === 'all' || record.caseId === state.caseId) &&
      matchesTime(record, state) && matchesFilters(record, state));
  }

  function clusterPlaces(records, places) {
    const clusters = new Map();
    for (const record of records) {
      const place = places.find(p => p.id === record.placeId);
      if (!place) continue;
      if (!clusters.has(place.id)) clusters.set(place.id, { place, records: [] });
      clusters.get(place.id).records.push(record);
    }
    return Array.from(clusters.values());
  }

  function daysBetween(a, b) {
    if (!isExactDate(a) || !isExactDate(b)) return null;
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function project(coordinates) {
    return [(coordinates[0] + 180) * 3, (90 - coordinates[1]) * 3];
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  return { MODES, REGIONS, isExactDate, normalizeState, readState, writeState, matchesTime,
    matchesFilters, visibleRecords, clusterPlaces, daysBetween, project, safeSourceUrl };
});
