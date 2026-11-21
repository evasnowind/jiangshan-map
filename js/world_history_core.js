/* Shared, dependency-free time and evidence rules for the world-history reader. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorldHistoryCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = ['day', 'year', 'topic'];
  function regionNames(data) { return data.regions.map(region => region.name); }

  function resolveRegions(values, data) {
    if (!Array.isArray(values)) return regionNames(data);
    return data.regions.filter(region => values.some(value =>
      [region.id, region.name, ...(region.aliases || []), ...(region.selectionAliases || [])].includes(value)
    )).map(region => region.name);
  }

  // Signed years are historical BCE/CE years, not ISO astronomical years.
  // The cursor uses a proleptic Gregorian calendar; sources keep their own calendar.
  function yearToIndex(year) { return year < 0 ? year : year - 1; }
  function indexToYear(index) { return index < 0 ? index : index + 1; }
  function yearValue(year) { return (year < 0 ? '-' : '') + String(Math.abs(year)).padStart(4, '0'); }
  function formatYear(year) { return (year < 0 ? '公元前' : '公元') + Math.abs(year) + '年'; }
  function yearOfDate(value) {
    const match = typeof value === 'string' && /^(-?\d{4})(?:-|$)/.exec(value);
    const year = match ? Number(match[1]) : NaN;
    return Number.isInteger(year) && year !== 0 ? year : null;
  }
  function parseDate(value) {
    const match = typeof value === 'string' && /^(-?\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = yearOfDate(value), month = Number(match[2]), day = Number(match[3]);
    if (year === null || month < 1 || month > 12) return null;
    const astronomical = year < 0 ? year + 1 : year;
    const leap = astronomical % 4 === 0 && (astronomical % 100 !== 0 || astronomical % 400 === 0);
    const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > months[month - 1]) return null;
    return { year, month, day, astronomical, months };
  }
  function isExactDate(value) { return Boolean(parseDate(value)); }
  function dateForYear(year, previous) {
    const value = yearValue(year) + '-' + (previous || '0001-01-01').slice(-5);
    return isExactDate(value) ? value : yearValue(year) + '-02-28';
  }
  function formatDate(value) {
    const date = parseDate(value);
    return date ? formatYear(date.year) + date.month + '月' + date.day + '日' : '';
  }
  function eraForState(data, state) { return (data.eras || []).find(era => era.id === state.eraId); }

  function normalizeState(input, data) {
    const defaults = data.defaultState;
    const caseId = input.caseId === 'all' || data.cases.some(c => c.id === input.caseId)
      ? input.caseId : defaults.caseId;
    const date = isExactDate(input.date) && yearOfDate(input.date) >= data.period.startYear &&
      yearOfDate(input.date) <= data.period.endYear ? input.date : defaults.date;
    const regions = resolveRegions(input.regions, data);
    const selected = data.records.find(record => record.id === input.recordId &&
      (caseId === 'all' || record.caseId === caseId));
    const comparison = caseId === 'all' && data.records.find(record => record.id === input.compareId &&
      record.id !== selected?.id && record.regions.includes('中国'));
    const state = {
      caseId,
      mode: MODES.includes(input.mode) ? input.mode : defaults.mode,
      date,
      eraId: caseId === 'all' && (data.eras || []).some(era => era.id === input.eraId) ? input.eraId : 'all',
      regions,
      query: typeof input.query === 'string' ? input.query.slice(0, 120) : '',
      recordId: selected?.id || null,
      compareId: comparison?.id || null
    };
    if (caseId === 'all') {
      const visible = visibleRecords(data, state);
      state.recordId = visible.find(record => record.id === state.recordId)?.id || visible[0]?.id || null;
      if (!state.recordId || state.compareId === state.recordId) state.compareId = null;
      const primary = visible.find(record => record.id === state.recordId);
      if (state.mode === 'topic' && primary?.date.precision === 'day') state.date = primary.date.value;
      else if (state.mode === 'topic' && primary?.date.precision === 'year') state.date = primary.date.value + '-01-01';
      // This cursor is a sorting reference, never a fabricated event date.
      else if (state.mode === 'topic' && primary?.date.precision === 'regnal_year') state.date = yearValue(primary.date.sortYear) + '-01-01';
    }
    return state;
  }

  function readState(search, data) {
    const params = new URLSearchParams(search);
    return normalizeState({
      caseId: params.get('case'), mode: params.get('mode'), date: params.get('date'),
      eraId: params.get('era'),
      regions: params.has('regions') ? params.get('regions').split(',') : undefined,
      query: params.get('q'), recordId: params.get('event'), compareId: params.get('compare')
    }, data);
  }

  function writeState(state, data) {
    const params = new URLSearchParams({ case: state.caseId, mode: state.mode, date: state.date });
    if (state.eraId && state.eraId !== 'all') params.set('era', state.eraId);
    if (state.regions.length !== regionNames(data).length) params.set('regions', state.regions.join(','));
    if (state.query.trim()) params.set('q', state.query.trim());
    if (state.recordId) params.set('event', state.recordId);
    if (state.compareId) params.set('compare', state.compareId);
    return '?' + params.toString();
  }

  function matchesTime(record, state, data) {
    if (state.mode === 'topic') {
      const era = data && eraForState(data, state);
      return !era || record.date.sortYear >= era.from && record.date.sortYear <= era.to;
    }
    if (record.date.precision === 'year' && /^-?\d{4}$/.test(record.date.value || ''))
      return state.mode === 'year' && yearOfDate(record.date.value) === yearOfDate(state.date);
    // A regnal year is not an inferred Gregorian year, month or day.
    if (record.date.precision !== 'day' || !isExactDate(record.date.value)) return false;
    return state.mode === 'day' ? record.date.value === state.date
      : yearOfDate(record.date.value) === yearOfDate(state.date);
  }

  function normalizeText(text) { return text.normalize('NFKC').toLocaleLowerCase(); }

  function matchesFilters(record, state, data) {
    if (!record.regions.some(region => state.regions.includes(region))) return false;
    const query = normalizeText(state.query.trim());
    if (!query) return true;
    return normalizeText([
      record.title, record.placeLabel, record.summary, record.regions.join(' '),
      ...(record.aliases || []), ...(record.polities || []), ...(record.parties || []),
      ...(data ? data.regions.filter(region => record.regions.includes(region.name)).flatMap(region => region.searchAliases || []) : []),
      ...record.people.map(p => p.name + ' ' + p.role)
    ].join(' ')).includes(query);
  }

  function visibleRecords(data, state) {
    return data.records.filter(record => (state.caseId === 'all' || record.caseId === state.caseId) &&
      matchesTime(record, state, data) && matchesFilters(record, state, data)).sort((a, b) =>
      a.date.sortYear - b.date.sortYear || (a.date.value || '').localeCompare(b.date.value || '') || a.id.localeCompare(b.id));
  }

  function regionContexts(data, region, state) {
    const year = yearOfDate(state.date);
    return region.contexts.filter(context => context.from <= year && context.to >= year);
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
    function ordinal(value) {
      const date = parseDate(value);
      if (!date) return null;
      const previous = date.astronomical - 1;
      return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400)
        + date.months.slice(0, date.month - 1).reduce((sum, days) => sum + days, 0) + date.day - 1;
    }
    const from = ordinal(a), to = ordinal(b);
    return from === null || to === null ? null : to - from;
  }

  function relationLabel(a, b) {
    if (a.date.precision === 'regnal_year' || b.date.precision === 'regnal_year')
      return '主题对读 · 日期精度不同';
    const years = [yearOfDate(a.date.value), yearOfDate(b.date.value)];
    const days = daysBetween(a.date.value, b.date.value);
    if (days === 0) return '同日 · 文献对读';
    if (years[0] === years[1]) return days === null ? '同年 · 含年级精度' : '同年 · 相隔' + Math.abs(days) + '天';
    return '跨年对读 · ' + years.map(year => year < 100 ? formatYear(year) : String(year)).join(' / ');
  }

  function project(coordinates) {
    return [(coordinates[0] + 180) * 3, (90 - coordinates[1]) * 3];
  }

  // View-only clustering never changes an event's evidence-backed location.
  function spatialClusters(records, places, scale, ratio, radius = 38) {
    const points = clusterPlaces(records, places).map(cluster => ({
      place: cluster.place, records: cluster.records, point: project(cluster.place.coordinates)
    }));
    const parents = points.map((_, i) => i);
    function find(i) { if (parents[i] !== i) parents[i] = find(parents[i]); return parents[i]; }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const distance = Math.hypot(points[i].point[0] - points[j].point[0], points[i].point[1] - points[j].point[1]) * scale * ratio;
      if (distance < radius) parents[find(j)] = find(i);
    }
    const groups = new Map();
    points.forEach((point, i) => {
      const parent = find(i);
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(point);
    });
    return Array.from(groups.values()).map(group => ({
      places: group.map(point => point.place),
      records: Array.from(new Map(group.flatMap(point => point.records).map(record => [record.id, record])).values()),
      point: [0, 1].map(axis => group.reduce((sum, point) => sum + point.point[axis], 0) / group.length)
    }));
  }

  function clusterAction(cluster, scale, maximum = 32) {
    if (cluster.places.length > 1) return scale < maximum ? 'zoom' : 'choose';
    return cluster.records.length > 1 ? 'choose' : 'select';
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }

  return { MODES, regionNames, resolveRegions, regionContexts, yearToIndex, indexToYear, yearValue, yearOfDate, formatYear,
    formatDate, dateForYear, eraForState, isExactDate, normalizeState, readState, writeState, matchesTime,
    matchesFilters, visibleRecords, clusterPlaces, spatialClusters, clusterAction, daysBetween, relationLabel, project, safeSourceUrl };
});
