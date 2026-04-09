function createLayerOptions() {
  selectedLayer.innerHTML = '';
  for (const layer of state.layers) {
    const opt = document.createElement('option');
    opt.value = layer.id;
    opt.textContent = layer.name;
    selectedLayer.appendChild(opt);
  }
}
function renderLayerList() {
  layerList.innerHTML = '';
  for (const layer of state.layers) {
    const item = document.createElement('div');
    item.className = `layer-item${state.activeLayerId === layer.id ? ' active' : ''}`;
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    left.innerHTML = `<span>${layer.name}</span><span class="badge">${state.nodes.filter((n) => n.layerId === layer.id).length}</span>`;
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '6px';
    const btnVisible = document.createElement('button');
    btnVisible.className = 'small';
    btnVisible.textContent = layer.visible ? '表示' : '非表示';
    btnVisible.onclick = (ev) => { ev.stopPropagation(); commitHistory(); layer.visible = !layer.visible; render(); };
    const btnLock = document.createElement('button');
    btnLock.className = 'small';
    btnLock.textContent = layer.locked ? 'ロック中' : '未ロック';
    btnLock.onclick = (ev) => { ev.stopPropagation(); commitHistory(); layer.locked = !layer.locked; render(); };
    right.appendChild(btnVisible);
    right.appendChild(btnLock);
    item.appendChild(left);
    item.appendChild(right);
    item.onclick = () => { state.activeLayerId = layer.id; render(); };
    layerList.appendChild(item);
  }
}
function renderSelectionList() {
  selectionList.innerHTML = '';
  if (!state.selectedIds.length && !state.selectedEdgeId) {
    selectionList.innerHTML = '<div class="selection-item"><span>未選択</span></div>';
    return;
  }
  if (state.selectedEdgeId) {
    const edge = getEdge(state.selectedEdgeId);
    const item = document.createElement('div');
    item.className = 'selection-item';
    item.innerHTML = `<span>接続 ${edge?.connector || ''}</span><span class="badge">edge</span>`;
    selectionList.appendChild(item);
    return;
  }
  for (const id of state.selectedIds) {
    const n = getNode(id);
    if (!n) continue;
    const item = document.createElement('div');
    item.className = 'selection-item';
    item.innerHTML = `<span>${n.label || '(名称なし)'}</span><span class="badge">${n.type}</span>`;
    item.onclick = () => setPrimarySelection(id);
    selectionList.appendChild(item);
  }
}

function drawGrid() {
  grid.innerHTML = '';
  majorGrid.innerHTML = '';
  const b = visibleWorldBounds();
  const sx = Math.floor(b.left / GRID) * GRID;
  const ex = Math.ceil(b.right / GRID) * GRID;
  const sy = Math.floor(b.top / GRID) * GRID;
  const ey = Math.ceil(b.bottom / GRID) * GRID;
  for (let x = sx; x <= ex; x += GRID) {
    const line = createSvg('line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', sy);
    line.setAttribute('x2', x);
    line.setAttribute('y2', ey);
    grid.appendChild(line);
  }
  for (let y = sy; y <= ey; y += GRID) {
    const line = createSvg('line');
    line.setAttribute('x1', sx);
    line.setAttribute('y1', y);
    line.setAttribute('x2', ex);
    line.setAttribute('y2', y);
    grid.appendChild(line);
  }
  for (let x = Math.floor(b.left / MAJOR_GRID) * MAJOR_GRID; x <= Math.ceil(b.right / MAJOR_GRID) * MAJOR_GRID; x += MAJOR_GRID) {
    const line = createSvg('line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', sy);
    line.setAttribute('x2', x);
    line.setAttribute('y2', ey);
    majorGrid.appendChild(line);
  }
  for (let y = Math.floor(b.top / MAJOR_GRID) * MAJOR_GRID; y <= Math.ceil(b.bottom / MAJOR_GRID) * MAJOR_GRID; y += MAJOR_GRID) {
    const line = createSvg('line');
    line.setAttribute('x1', sx);
    line.setAttribute('y1', y);
    line.setAttribute('x2', ex);
    line.setAttribute('y2', y);
    majorGrid.appendChild(line);
  }
}
function drawGuides() {
  guidesLayer.innerHTML = '';
  if (!guideToggle.checked) return;
  for (const g of state.guides) {
    const line = createSvg('line');
    line.setAttribute('class', 'guide');
    line.setAttribute('x1', g.x1);
    line.setAttribute('y1', g.y1);
    line.setAttribute('x2', g.x2);
    line.setAttribute('y2', g.y2);
    guidesLayer.appendChild(line);
  }
}
function sortedVisibleNodes() {
  return [...state.nodes].filter((n) => getLayer(n.layerId)?.visible !== false).sort((a, b) => (a.z || 0) - (b.z || 0));
}
function drawEdges() {
  edgesLayer.innerHTML = '';
  for (const edge of state.edges) {
    const fromNode = getNode(edge.from);
    const toNode = getNode(edge.to);
    if (!fromNode || !toNode) continue;
    if (getLayer(fromNode.layerId)?.visible === false || getLayer(toNode.layerId)?.visible === false) continue;
    const d = edgePath(edge);
    const hit = createSvg('path');
    hit.setAttribute('class', 'edge-hit');
    hit.setAttribute('d', d);
    hit.dataset.kind = 'edge';
    hit.dataset.id = edge.id;
    edgesLayer.appendChild(hit);
    const p = createSvg('path');
    p.setAttribute('class', `edge${state.selectedEdgeId === edge.id ? ' selected' : ''}`);
    p.setAttribute('d', d);
    p.setAttribute('marker-end', edgeMarker(edge));
    p.style.pointerEvents = 'none';
    edgesLayer.appendChild(p);
  }
}
function nodeClass(node) {
  const cls = ['node'];
  if (isSelected(node.id)) cls.push(node.id === state.primarySelectedId ? 'primary-selected' : 'multi-selected');
  if (node.type === 'start') cls.push('flow-start');
  if (node.type === 'decision') cls.push('flow-decision');
  if (node.type === 'container') cls.push('container');
  return cls.join(' ');
}
function drawNodes() {
  nodesLayer.innerHTML = '';
  for (const node of sortedVisibleNodes()) {
    const g = createSvg('g');
    g.setAttribute('class', nodeClass(node));
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    g.dataset.kind = 'node';
    g.dataset.id = node.id;
    const path = createSvg('path');
    path.setAttribute('class', 'shape');
    path.setAttribute('d', shapePath({ ...node, x: 0, y: 0 }));
    path.style.setProperty('--node-fill', node.fill || '#192447');
    path.style.setProperty('--node-stroke', node.noStroke ? 'transparent' : (node.stroke || '#7389df'));
    path.style.setProperty('--node-stroke-width', node.noStroke ? '0' : '2');
    g.appendChild(path);
    const text = createSvg('text');
    text.setAttribute('class', 'label');
    text.style.fill = node.textColor || '#ffffff';
    const lines = wrapText(node.label, Math.max(8, Math.floor(node.w / 14)));
    const startY = lines.length === 1 ? 0 : -(lines.length - 1) * 9;
    lines.forEach((line, idx) => {
      const t = createSvg('tspan');
      t.setAttribute('x', 0);
      t.setAttribute('y', startY + idx * 18);
      t.textContent = line;
      text.appendChild(t);
    });
    g.appendChild(text);
    if (portToggle.checked && (state.mode === 'connect' || node.id === state.primarySelectedId)) {
      const ports = getPorts({ ...node, x: 0, y: 0 });
      for (const p of Object.values(ports)) {
        const c = createSvg('circle');
        c.setAttribute('class', 'port');
        c.setAttribute('cx', p.x);
        c.setAttribute('cy', p.y);
        c.setAttribute('r', 5);
        g.appendChild(c);
      }
    }
    if (node.id === state.primarySelectedId) {
      const h = createSvg('rect');
      h.setAttribute('class', 'handle');
      h.setAttribute('x', node.w / 2 - 8);
      h.setAttribute('y', node.h / 2 - 8);
      h.setAttribute('width', 12);
      h.setAttribute('height', 12);
      h.dataset.kind = 'resize';
      h.dataset.id = node.id;
      g.appendChild(h);
    }
    nodesLayer.appendChild(g);
  }
}
function drawTemp() {
  tempLayer.innerHTML = '';
  if (state.mode === 'connect' && state.connectFrom && state.tempMouse) {
    const fromNode = getNode(state.connectFrom);
    if (!fromNode) return;
    const pseudo = { x: state.tempMouse.x, y: state.tempMouse.y, w: 10, h: 10, type: 'process' };
    const sides = inferPortSides(fromNode, pseudo);
    const start = getPortPoint(fromNode, sides.fromSide);
    const end = { x: state.tempMouse.x, y: state.tempMouse.y };
    const type = connectorTypeEl.value;
    const d = type === 'straight'
      ? straightPath(start, end)
      : type === 'bezier'
        ? bezierPath(start, end, sides.fromSide, sides.toSide)
        : orthogonalPath(start, end, sides.fromSide, sides.toSide);
    const path = createSvg('path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#5eead4');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-dasharray', '8 6');
    tempLayer.appendChild(path);
  }
}
function drawSelectionRect() {
  selectionLayer.innerHTML = '';
  if (state.selectionRect) {
    const r = createSvg('rect');
    r.setAttribute('class', 'selection-box');
    r.setAttribute('x', Math.min(state.selectionRect.x1, state.selectionRect.x2));
    r.setAttribute('y', Math.min(state.selectionRect.y1, state.selectionRect.y2));
    r.setAttribute('width', Math.abs(state.selectionRect.x2 - state.selectionRect.x1));
    r.setAttribute('height', Math.abs(state.selectionRect.y2 - state.selectionRect.y1));
    selectionLayer.appendChild(r);
  }
  if (!state.selectedEdgeId) return;
  const edge = getEdge(state.selectedEdgeId);
  const fromNode = edge ? getNode(edge.from) : null;
  const toNode = edge ? getNode(edge.to) : null;
  if (!edge || !fromNode || !toNode) return;
  [
    { end: 'from', point: getPortPoint(fromNode, edge.fromSide) },
    { end: 'to', point: getPortPoint(toNode, edge.toSide) },
  ].forEach(({ end, point }) => {
    const handle = createSvg('circle');
    handle.setAttribute('class', 'edge-handle');
    handle.setAttribute('cx', point.x);
    handle.setAttribute('cy', point.y);
    handle.setAttribute('r', 7);
    handle.dataset.kind = 'edge-handle';
    handle.dataset.id = edge.id;
    handle.dataset.end = end;
    selectionLayer.appendChild(handle);
  });
}
function drawMinimap() {
  miniContent.innerHTML = '';
  const nodes = sortedVisibleNodes();
  if (!nodes.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  });
  const pad = 80;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const scale = Math.min(210 / Math.max(1, maxX - minX), 140 / Math.max(1, maxY - minY));
  state.edges.forEach((e) => {
    const a = getNode(e.from);
    const b = getNode(e.to);
    if (!a || !b) return;
    const line = createSvg('line');
    line.setAttribute('x1', (a.x - minX) * scale);
    line.setAttribute('y1', (a.y - minY) * scale);
    line.setAttribute('x2', (b.x - minX) * scale);
    line.setAttribute('y2', (b.y - minY) * scale);
    line.setAttribute('stroke', '#7f8fca');
    line.setAttribute('stroke-width', 1);
    miniContent.appendChild(line);
  });
  nodes.forEach((n) => {
    const r = createSvg('rect');
    r.setAttribute('x', (n.x - n.w / 2 - minX) * scale);
    r.setAttribute('y', (n.y - n.h / 2 - minY) * scale);
    r.setAttribute('width', Math.max(4, n.w * scale));
    r.setAttribute('height', Math.max(4, n.h * scale));
    r.setAttribute('rx', 4);
    r.setAttribute('fill', isSelected(n.id) ? '#ffd166' : '#6d85dc');
    miniContent.appendChild(r);
  });
  const v = visibleWorldBounds();
  miniViewport.setAttribute('x', (v.left - minX) * scale);
  miniViewport.setAttribute('y', (v.top - minY) * scale);
  miniViewport.setAttribute('width', (v.right - v.left) * scale);
  miniViewport.setAttribute('height', (v.bottom - v.top) * scale);
}

function updateViewportTransform() {
  viewport.setAttribute('transform', `translate(${-state.view.x * state.view.scale}, ${-state.view.y * state.view.scale}) scale(${state.view.scale})`);
}
function updateInspector() {
  const node = getPrimaryNode();
  const active = document.activeElement;
  createLayerOptions();
  if (node) {
    if (active !== selectedLabel) selectedLabel.value = node.label;
    if (active !== selectedW) selectedW.value = String(node.w);
    if (active !== selectedH) selectedH.value = String(node.h);
    if (active !== selectedFill) selectedFill.value = node.fill || '#192447';
    if (active !== selectedStroke) selectedStroke.value = node.stroke || '#7389df';
    if (active !== selectedTextColor) selectedTextColor.value = node.textColor || '#ffffff';
    if (active !== selectedNoStroke) selectedNoStroke.checked = !!node.noStroke;
    if (active !== selectedType) selectedType.value = node.type;
    if (active !== selectedLayer) selectedLayer.value = node.layerId || state.activeLayerId;
  } else {
    selectedLabel.value = '';
    selectedW.value = '';
    selectedH.value = '';
    selectedFill.value = '#192447';
    selectedStroke.value = '#7389df';
    selectedTextColor.value = '#ffffff';
    selectedNoStroke.checked = false;
    selectedType.value = 'mind';
    selectedLayer.value = state.activeLayerId;
  }
}
function render() {
  updateViewportTransform();
  drawGrid();
  drawGuides();
  drawEdges();
  drawNodes();
  drawTemp();
  drawSelectionRect();
  drawMinimap();
  updateInspector();
  renderLayerList();
  renderSelectionList();
  document.getElementById('zoomReset').textContent = `${Math.round(state.view.scale * 100)}%`;
  scheduleAutosave();
}
