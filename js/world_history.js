(function () {
  'use strict';
  const core = window.WorldHistoryCore;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  let data, state, selectedId = null, clusterOpener = null;
  const camera = { scale: 1, x: 0, y: 0 };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, attrs) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    return node;
  }

  function sourceLink(text, url) {
    const link = element('a', 'source-link', text);
    const safeUrl = core.safeSourceUrl(url);
    if (safeUrl) { link.href = safeUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    return link;
  }

  function button(text, handler, className) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function currentCase() { return data.cases.find(c => c.id === state.caseId); }
  function announce(message) { $('announcement').textContent = message; }

  function setState(patch, replace) {
    const previous = state;
    state = core.normalizeState(Object.assign({}, state, patch), data);
    if (previous.caseId !== state.caseId || previous.regions.join('|') !== state.regions.join('|'))
      Object.assign(camera, { scale: 1, x: 0, y: 0 });
    const query = core.writeState(state, data);
    if (query !== window.location.search) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', window.location.pathname + query + window.location.hash);
    }
    render();
  }

  function selectCase(item) {
    setState({ caseId: item.id, mode: item.defaultMode, date: item.defaultDate, query: '',
      regions: core.regionNames(data), recordId: null, compareId: null });
  }

  function selectRecord(record, scroll) {
    setState({ caseId: state.caseId === 'all' ? 'all' : record.caseId || 'all', recordId: record.id,
      date: record.date.precision === 'day' ? record.date.value : state.date });
    if (scroll) {
      $('comparison').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('comparison').focus({ preventScroll: true });
    }
  }

  function buildCaseButtons() {
    const container = $('case-buttons');
    const all = button('全部地区史事', () => {
      setState({ caseId: 'all', mode: 'topic', query: '', regions: core.regionNames(data), recordId: null, compareId: null });
    }, 'case-button overview-button');
    all.dataset.case = 'all';
    container.append(all);
    for (const item of data.cases) {
      const node = button('', () => selectCase(item), 'case-button');
      node.dataset.case = item.id;
      node.append(element('strong', '', item.title), element('span', '', item.subtitle));
      container.append(node);
    }
  }

  function buildRegions() {
    const jump = $('region-jump');
    for (const [value, text] of [['all', '全部地区'], ['multiple', '多地区组合'], ['none', '未选地区']]) {
      const option = element('option', '', text); option.value = value; option.disabled = value !== 'all'; jump.append(option);
    }
    const groups = new Map();
    for (const region of data.regions) {
      if (!groups.has(region.group)) {
        const optgroup = element('optgroup'); optgroup.label = region.group; jump.append(optgroup); groups.set(region.group, optgroup);
      }
      const count = data.records.filter(record => record.regions.includes(region.name)).length;
      const option = element('option', '', region.name + ' · ' + count + '条相关记录'); option.value = region.id;
      groups.get(region.group).append(option);
      const label = element('label'); const input = element('input'); input.type = 'checkbox'; input.value = region.name;
      label.append(input, element('span', '', region.name), element('span', 'region-total', String(count)));
      $('region-filters').append(label);
    }
    $('period-label').textContent = data.period.startYear + '—' + data.period.endYear + ' · ' + data.regions.length + '个地区';
    $('sample-note').replaceChildren(document.createTextNode(data.regions.length + '个地区 · 3组精读'), element('br'),
      element('span', '', data.records.length + '项记录 · 原文逐条可查'));
  }

  function renderRegionContext() {
    const container = $('region-context');
    const wasOpen = container.querySelector('details')?.open;
    container.replaceChildren();
    const selected = data.regions.filter(region => state.regions.includes(region.name));
    if (!selected.length) { container.append(element('p', '', '未选地区。可用“地区速览”选择一处，或恢复全部地区。')); return; }
    const content = selected.length <= 2 ? container : element('details');
    if (selected.length > 2) { content.open = Boolean(wasOpen); content.append(element('summary', '', '这些地区在当时叫什么？')); container.append(content); }
    for (const region of selected) {
      const contexts = core.regionContexts(data, region, state);
      content.append(element('h3', '', region.name), element('p', 'historical-name', contexts.map(c => c.label).join(' / ')),
        element('p', '', region.note));
    }
  }

  function renderControls() {
    $('share').textContent = '复制当前视图链接';
    $('case-reset').textContent = currentCase() ? '回到本组时间' : '恢复全部史事';
    const year = state.date.slice(0, 4);
    $('time-heading').textContent = state.mode === 'day' ? state.date.replace(/-/g, ' / ')
      : state.mode === 'year' ? year + '年' : '1852—1868 · 专题全时段';
    $('year-output').textContent = year;
    $('year-range').value = year;
    $('year-range').disabled = state.mode === 'topic';
    $('exact-date').value = state.date;
    $('exact-date').disabled = state.mode !== 'day';
    $('time-note').textContent = state.mode === 'topic'
      ? '不同日期的记录在此并置，时间差仍在对照中保留；它们不都发生在同一天。'
      : state.mode === 'year' ? '只显示已确定西历年份的记录。原署咸丰二年的魏源序文可在“专题全时段”阅读。'
        : '地图只显示此日的确日记录；另一日期的材料会以历史对照卡保留。';
    for (const input of document.querySelectorAll('input[name="mode"]')) input.checked = input.value === state.mode;
    for (const input of document.querySelectorAll('#region-filters input')) input.checked = state.regions.includes(input.value);
    $('region-count').textContent = state.regions.length + '/' + data.regions.length;
    $('region-jump').value = state.regions.length === data.regions.length ? 'all' : state.regions.length === 1
      ? data.regions.find(region => region.name === state.regions[0]).id : state.regions.length ? 'multiple' : 'none';
    renderRegionContext();
    if ($('record-search').value !== state.query) $('record-search').value = state.query;
    for (const node of $('case-buttons').children) node.setAttribute('aria-pressed', String(node.dataset.case === state.caseId));
  }

  function renderRecords(records) {
    const container = $('record-list');
    container.replaceChildren();
    $('visible-count').textContent = records.length + '项记录 · ' + core.clusterPlaces(records, data.places).length + '处地点';
    if (!records.length) {
      const empty = element('div', 'empty-state');
      empty.append(element('strong', '', '当前条件下没有记录'), element('p', '', '本轮收录' + data.records.length + '项材料。没有记录不等于当时没有历史。'),
        button('查看所选地区全时段史事', () => setState({caseId:'all', mode:'topic', query:'',recordId:null,compareId:null}), 'text-button'),
        button(currentCase() ? '恢复本组时间与筛选' : '恢复全部地区与史事', resetCase, 'text-button'));
      container.append(empty);
      return;
    }
    for (const record of records) {
      const node = button('', () => selectRecord(record, true), 'record-button');
      node.dataset.record = record.id;
      node.setAttribute('aria-pressed', String(record.id === selectedId));
      node.append(element('span', 'record-date', record.date.display), element('strong', '', record.title),
        element('span', 'muted', record.placeLabel));
      container.append(node);
    }
  }

  function updateCamera() {
    camera.x = Math.min(0, Math.max(1080 * (1 - camera.scale), camera.x));
    camera.y = Math.min(0, Math.max(540 * (1 - camera.scale), camera.y));
    $('map-viewport').setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    const bounds = $('world-map').getBoundingClientRect();
    const ratio = Math.min(bounds.width / 1080, bounds.height / 540) || 1;
    for (const marker of $('map-markers').children) {
      marker.setAttribute('transform', `translate(${marker.dataset.x} ${marker.dataset.y}) scale(${1 / (camera.scale * ratio)})`);
    }
    $('world-map').style.touchAction = camera.scale > 1 ? 'none' : 'pan-y';
    $('zoom-in').disabled = camera.scale >= 32;
    $('zoom-out').disabled = camera.scale <= 1;
  }

  function zoom(factor) {
    const next = Math.max(1, Math.min(32, camera.scale * factor));
    camera.x = 540 - (540 - camera.x) / camera.scale * next;
    camera.y = 270 - (270 - camera.y) / camera.scale * next;
    camera.scale = next;
    renderMarkers(core.visibleRecords(data, state));
  }

  function locate(place) {
    const point = core.project(place.coordinates);
    camera.scale = 4;
    camera.x = 540 - point[0] * camera.scale;
    camera.y = 270 - point[1] * camera.scale;
    renderMarkers(core.visibleRecords(data, state));
    $('world-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    announce('地图已定位到' + place.label + '，' + place.note);
  }

  function renderMarkers(records) {
    const group = $('map-markers');
    group.replaceChildren();
    $('cluster-menu').hidden = true;
    $('cluster-records').replaceChildren();
    const offsets = { tianjin: [-17, -10], gaoyou: [-17, 28], kyoto: [17, 27], 'edo-bay': [-18, -40], washington: [18, -12] };
    const bounds = $('world-map').getBoundingClientRect();
    const ratio = Math.min(bounds.width / 1080, bounds.height / 540) || 1;
    for (const cluster of core.spatialClusters(records, data.places, camera.scale, ratio)) {
      const [x, y] = cluster.point;
      const aggregate = cluster.places.length > 1;
      const action = core.clusterAction(cluster, camera.scale);
      const place = cluster.places[0];
      const labelText = aggregate ? cluster.places.length + '处地点 · ' + cluster.records.length + '项' : (place.shortLabel || place.label) +
        (cluster.records.length > 1 ? ' · ' + cluster.records.length : '');
      const isArea = !aggregate && place.precision === 'area_reference';
      const selected = cluster.records.some(r => r.id === selectedId);
      const marker = svgElement('g', { role: 'button', tabindex: '0',
        'aria-label': cluster.places.map(p => p.label).join('、') + '，' + cluster.records.length + '项记录，' + (action === 'zoom' ? '放大这些地点' : action === 'choose' ? '选择史事' : '打开历史对照'),
        'aria-pressed': String(selected), class: 'map-marker' + (selected ? ' selected' : '') + (isArea ? ' area-marker' : '') + (aggregate ? ' aggregate-marker' : '') });
      marker.dataset.x = x;
      marker.dataset.y = y;
      marker.dataset.recordIds = cluster.records.map(record => record.id).join(',');
      const title = svgElement('title'); title.textContent = aggregate ? '视图聚合：' + cluster.places.map(p => p.label).join('、') : place.label + '：' + place.note;
      marker.append(title, svgElement('circle', { r: 18, class: 'marker-hit' }),
        svgElement('circle', { r: aggregate ? 13 : isArea ? 11 : 8, class: 'marker-ring' }));
      if (aggregate) { const count = svgElement('text', { class:'cluster-number', 'text-anchor':'middle', y:5 }); count.textContent = cluster.places.length; marker.append(count); }
      else marker.append(svgElement('circle', { r: 3.5, class: 'marker-dot' }));
      const [dx, dy] = aggregate ? [18,-15] : offsets[place.id] || (x > 800 ? [-18,-12] : [18,-12]);
      const label = svgElement('text', { x: dx, y: dy, 'text-anchor': dx < 0 ? 'end' : 'start' });
      label.textContent = labelText;
      marker.append(label);
      const activate = () => {
        if (action === 'select') { selectRecord(cluster.records[0], true); return; }
        if (action === 'choose') { showClusterChoices(cluster, marker); return; }
        const points = cluster.places.map(p => core.project(p.coordinates));
        const spanX = Math.max(...points.map(p=>p[0])) - Math.min(...points.map(p=>p[0]));
        const spanY = Math.max(...points.map(p=>p[1])) - Math.min(...points.map(p=>p[1]));
        camera.scale = Math.min(32, Math.max(camera.scale*1.6, Math.min(700/Math.max(1,spanX),350/Math.max(1,spanY))));
        camera.x = 540 - x * camera.scale; camera.y = 270 - y * camera.scale;
        const restoreFocus = document.activeElement === marker;
        renderMarkers(records);
        if (restoreFocus) Array.from($('map-markers').children).find(node => node.dataset.recordIds.split(',').includes(cluster.records[0].id))?.focus();
        announce('已放大' + cluster.places.map(p=>p.label).join('、'));
      };
      marker.addEventListener('click', activate);
      marker.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
      group.append(marker);
    }
    updateCamera();
  }

  function showClusterChoices(cluster, opener) {
    clusterOpener = opener;
    const container = $('cluster-records'); container.replaceChildren();
    for (const record of cluster.records) container.append(button(record.placeLabel + ' · ' + record.title, () => {
      $('cluster-menu').hidden = true; selectRecord(record, true);
    }, 'cluster-record-choice'));
    $('cluster-menu').hidden = false;
    container.querySelector('button')?.focus();
  }

  function closeClusterChoices() {
    $('cluster-menu').hidden = true;
    if (clusterOpener?.isConnected) clusterOpener.focus();
  }

  function renderCard(record, visibleIds) {
    const card = element('article', 'comparison-card' + (record.id === selectedId ? ' selected' : ''));
    card.id = 'record-' + record.id;
    const inTime = core.matchesTime(record, state);
    const context = visibleIds.has(record.id) ? (state.mode === 'topic' ? '专题材料 · 保留各自日期' : '当前时间与筛选内')
      : !inTime ? '历史对照 · 不在当前时间内' : '对照保留 · 不在当前地区或搜索筛选内';
    card.append(element('p', 'context-label' + (!visibleIds.has(record.id) ? ' off-time' : ''), context));
    const tags = element('div', 'tags');
    for (const region of record.regions) tags.append(element('span', 'tag', region));
    card.append(tags, element('h3', '', record.title), element('p', 'event-date', record.date.display),
      element('p', 'original-date', record.date.original));
    const place = data.places.find(p => p.id === record.placeId);
    const location = element('p', 'location-line', record.placeRole + '：' + record.placeLabel + ' ');
    if (visibleIds.has(record.id)) location.append(button('地图定位', () => locate(place), 'text-button'));
    card.append(location, element('p', '', record.summary));
    if (record.polities?.length) card.append(element('p', 'historical-name', '当时政权／关系：' + record.polities.join('、')));
    if (record.parties?.length) card.append(element('p', 'muted', '文书参与方：' + record.parties.join('、')));
    const claims = element('ul', 'claim-list');
    for (const claim of record.claims) {
      const item = element('li');
      item.append(element('p', '', claim.text), sourceLink('[' + claim.sourceId + '] ' + claim.locator, claim.url));
      claims.append(item);
    }
    card.append(claims, element('h4', '', '人物与本次角色'));
    const people = element('dl', 'people-list');
    for (const person of record.people) people.append(element('dt', '', person.name), element('dd', '', person.role));
    card.append(people);
    const evidence = element('details', 'evidence-detail');
    evidence.append(element('summary', '', '对读原文与核查状态'));
    const quote = element('blockquote', '', record.quote.text);
    const material = data.sources.find(s => s.id === record.quote.sourceId);
    evidence.append(quote, element('p', '', '本轮释读：' + record.quote.translation),
      sourceLink('[' + material.id + '] ' + record.quote.locator, record.quote.url),
      element('p', 'source-kind', material.kind), element('p', 'muted', material.checked),
      element('p', 'evidence-limit', material.limitation), element('p', 'review-state', '第三方专业审读：待完成'));
    card.append(evidence, element('p', 'location-note', place.note), element('p', 'card-limit', record.limitation));
    return card;
  }

  function renderComparison(records) {
    const item = currentCase();
    const cards = $('comparison-cards');
    const conclusion = $('comparison-conclusion');
    cards.replaceChildren(); conclusion.replaceChildren();
    $('reading-tools').hidden = Boolean(item);
    if (!item) {
      const primary = records.find(record => record.id === state.recordId);
      const comparison = primary && data.records.find(record => record.id === state.compareId && record.id !== primary.id);
      $('comparison-title').textContent = primary ? primary.title : '选择一条史事，打开原文';
      $('relation-label').textContent = primary ? comparison ? core.relationLabel(primary, comparison)
        : primary.date.precision === 'day' ? '确日记录' : primary.date.precision === 'year' ? '年级精度' : '原署年 · 西历年界待核' : '当前筛选无记录';
      $('comparison-intro').textContent = '地区名称用于检索，当时政权与文献阶段另行说明。点选记录阅读来源，也可添加一项中国相关材料并排对读。';
      $('reading-tools').hidden = !primary;
      const select = $('china-comparison'); select.replaceChildren();
      const none = element('option', '', '暂不添加'); none.value = ''; select.append(none);
      for (const record of data.records.filter(record => record.regions.includes('中国') && record.id !== primary?.id)) {
        const option = element('option', '', record.date.display + ' · ' + record.title); option.value = record.id; select.append(option);
      }
      select.value = comparison?.id || '';
      $('reading-gap').textContent = comparison ? core.relationLabel(primary, comparison) + '。并列阅读不自动证明因果、传播或制度优劣。'
        : '对读材料不改变当前地图的时间与地区筛选，卡片会注明是否在筛选内。';
      const ids = new Set(records.map(record => record.id));
      if (primary) cards.append(renderCard(primary, ids));
      if (comparison) cards.append(renderCard(comparison, ids));
      cards.classList.remove('overview-cards');
      cards.classList.toggle('single-card', !comparison);
      conclusion.hidden = true;
      return;
    }
    cards.classList.remove('overview-cards', 'single-card'); conclusion.hidden = false;
    $('comparison-title').textContent = item.question;
    $('relation-label').textContent = item.relation;
    $('comparison-intro').textContent = item.intro;
    const ids = new Set(records.map(r => r.id));
    for (const record of data.records.filter(r => r.caseId === item.id)) cards.append(renderCard(record, ids));
    conclusion.append(element('h3', '', '这组对照说明什么'), element('p', '', item.conclusion),
      element('h4', '', '证据能够支持到哪里'), element('p', '', item.boundary));
  }

  function render() {
    selectedId = state.recordId;
    renderControls();
    const records = core.visibleRecords(data, state);
    renderRecords(records); renderMarkers(records); renderComparison(records);
  }

  function renderSources() {
    $('method-note').append(element('p', '', data.method), element('p', '', data.selection));
    for (const material of data.sources) {
      const card = element('article', 'source-card'); card.id = 'source-' + material.id;
      card.append(element('h3', '', material.id + ' · ' + material.title), element('p', 'source-kind', material.kind),
        element('p', '', material.locator), element('p', '', material.checked), element('p', 'muted', material.limitation),
        sourceLink('打开来源', material.url));
      if (material.parallelUrl) card.append(sourceLink(material.parallelLabel || '英文平行文本', material.parallelUrl));
      if (material.witnessUrl) card.append(sourceLink(material.witnessLabel || '传世控本著录', material.witnessUrl));
      card.append(element('p', 'review-state', '第三方专业审读：待完成'));
      $('source-list').append(card);
    }
    const geography = $('geography-sources');
    geography.append(element('h3', '', '地图和位置的来源'), element('p', '', data.basemap.note),
      sourceLink(data.basemap.title + ' · ' + data.basemap.version, data.basemap.url),
      sourceLink('数据许可：' + data.basemap.license, data.basemap.licenseUrl));
    const list = element('ul', 'coordinate-list');
    for (const place of data.places) {
      const item = element('li', '', place.label + '：' + place.note + ' ');
      item.append(sourceLink(place.coordinateLabel, place.coordinateSource)); list.append(item);
    }
    geography.append(list, element('p', 'muted', '位置资料核对日：' + data.researchDate + '。地图不绘制未经证明的传播、旅行或因果连线。'));
  }

  function drawBaseMap(land) {
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = core.project([lon, 0])[0];
      $('map-grid').append(svgElement('line', { x1: x, y1: 0, x2: x, y2: 540 }));
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = core.project([0, lat])[1];
      $('map-grid').append(svgElement('line', { x1: 0, y1: y, x2: 1080, y2: y }));
    }
    for (const feature of land.features) {
      const geometry = feature.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      const path = polygons.map(polygon => polygon.map(ring => ring.map((point, index) => {
        const [x, y] = core.project(point); return (index ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2);
      }).join('') + 'Z').join('')).join('');
      $('map-land').append(svgElement('path', { d: path, 'fill-rule': 'evenodd' }));
    }
    for (const [name, lon, lat] of [['太平洋',-150,5],['大西洋',-30,15],['印度洋',75,-25]]) {
      const [x,y] = core.project([lon,lat]);
      const label = svgElement('text', { x,y }); label.textContent = name; $('map-labels').append(label);
    }
  }

  function resetCase() {
    const item = currentCase();
    if (item) selectCase(item);
    else setState({ mode: 'topic', regions: core.regionNames(data), query: '',recordId:null,compareId:null });
  }

  function bindControls() {
    $('cluster-close').addEventListener('click', closeClusterChoices);
    $('cluster-menu').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeClusterChoices(); } });
    $('time-modes').addEventListener('change', event => setState({ mode: event.target.value, recordId:null }));
    $('year-range').addEventListener('input', event => {
      const year = event.target.value;
      let date = year + state.date.slice(4);
      if (!core.isExactDate(date)) date = year + '-02-28';
      setState({ date,recordId:null }, true);
    });
    $('exact-date').addEventListener('change', event => {
      if (event.target.validity.valid && core.isExactDate(event.target.value)) setState({ date: event.target.value,recordId:null });
      else { renderControls(); announce('请选择1852至1868年之间的有效日期。'); }
    });
    $('region-filters').addEventListener('change', () => setState({
      regions: Array.from(document.querySelectorAll('#region-filters input:checked'), input => input.value),recordId:null,compareId:null
    }));
    $('region-jump').addEventListener('change', event => {
      const region = data.regions.find(region => region.id === event.target.value);
      setState({caseId:'all', mode:'topic',regions:region?[region.name]:core.regionNames(data),query:'',recordId:null,compareId:null});
    });
    $('regions-all').addEventListener('click', () => setState({regions:core.regionNames(data),recordId:null,compareId:null}));
    $('regions-clear').addEventListener('click', () => setState({regions:[],recordId:null,compareId:null}));
    $('china-comparison').addEventListener('change', event => setState({compareId:event.target.value || null}));
    $('record-search').addEventListener('input', event => setState({ query: event.target.value,recordId:null }, true));
    $('case-reset').addEventListener('click', resetCase);
    $('zoom-in').addEventListener('click', () => zoom(1.5));
    $('zoom-out').addEventListener('click', () => zoom(1 / 1.5));
    $('zoom-reset').addEventListener('click', () => { Object.assign(camera, { scale: 1, x: 0, y: 0 }); renderMarkers(core.visibleRecords(data,state)); });
    window.addEventListener('popstate', () => { state = core.readState(window.location.search, data); selectedId = null; render(); });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => renderMarkers(core.visibleRecords(data,state))).observe($('world-map'));
    $('share').addEventListener('click', async () => {
      try {
        const link = window.location.origin + window.location.pathname + core.writeState(state, data) + window.location.hash;
        await navigator.clipboard.writeText(link);
        $('share').textContent = '链接已复制'; announce('当前专题、日期和筛选条件的链接已复制。');
      } catch (_) { $('share').textContent = '请复制地址栏链接'; announce('当前环境无法访问剪贴板，请复制地址栏中的链接。'); }
    });
    let drag = null;
    const map = $('world-map');
    map.addEventListener('pointerdown', event => {
      if (event.target.closest('.map-marker') || event.button !== 0 || camera.scale === 1) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y };
      map.setPointerCapture(event.pointerId);
    });
    map.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const bounds = map.getBoundingClientRect();
      const ratio = Math.min(bounds.width / 1080, bounds.height / 540);
      camera.x = drag.startX + (event.clientX - drag.x) / ratio;
      camera.y = drag.startY + (event.clientY - drag.y) / ratio;
      updateCamera();
    });
    const stopDrag = () => { drag = null; };
    map.addEventListener('pointerup', stopDrag); map.addEventListener('pointercancel', stopDrag);
    map.addEventListener('lostpointercapture', stopDrag);
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function init() {
    try {
      if (!core) throw new Error('Missing time rules');
      const results = await Promise.allSettled([fetchJson($('world-history-script').dataset.recordsSrc), fetchJson('data/world/land-110m.geojson')]);
      if (results[0].status !== 'fulfilled') throw results[0].reason;
      data = results[0].value;
      state = core.readState(window.location.search, data);
      buildCaseButtons(); buildRegions(); renderSources(); bindControls();
      if (results[1].status === 'fulfilled') drawBaseMap(results[1].value);
      else {
        $('load-status').textContent = '陆地底图暂未载入，记录和证据仍可阅读。刷新页面可重试。';
        $('load-status').classList.add('load-warning');
      }
      $('reader').hidden = false;
      render();
      if (results[1].status === 'fulfilled') $('load-status').hidden = true;
    } catch (_) {
      $('load-status').replaceChildren(element('p', '', '历史记录未能载入。请通过本地HTTP服务打开此页面，或刷新后重试。'),
        button('重新载入', () => window.location.reload(), 'text-button'));
      $('load-status').setAttribute('role', 'alert');
    }
  }
  init();
})();
