function setMode(mode) {
  state.mode = mode;
  [...modeChips.querySelectorAll('.chip')].forEach((chip) => chip.classList.toggle('active', chip.dataset.mode === mode));
  state.connectFrom = null;
  render();
  setStatus(`モード: ${mode}`);
}
function setShapeToAdd(shape) {
  state.shapeToAdd = shape;
  [...shapeLibrary.querySelectorAll('.shape-card')].forEach((card) => card.classList.toggle('active', card.dataset.shape === shape));
}

function nextZ() { return state.nodes.reduce((m, n) => Math.max(m, n.z || 0), 0) + 1; }
function addNodeAt(x, y, type = state.shapeToAdd) {
  const presets = {
    mind: { w: 150, h: 60, label: '新規ノード', type: 'mind', fill: '#192447', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    process: { w: 150, h: 60, label: '処理', type: 'process', fill: '#192447', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    decision: { w: 140, h: 90, label: '判断', type: 'decision', fill: '#3a254d', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    start: { w: 170, h: 54, label: '開始 / 終了', type: 'start', fill: '#17304f', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    container: { w: 260, h: 180, label: 'コンテナ', type: 'container', fill: 'rgba(63, 92, 173, 0.18)', stroke: '#7aa2ff', textColor: '#ffffff', noStroke: false },
  };
  const p = presets[type] || presets.mind;
  const node = { id: uid('n'), x: maybeSnap(x), y: maybeSnap(y), z: nextZ(), layerId: state.activeLayerId, groupId: null, ...p };
  state.nodes.push(node);
  state.selectedIds = [node.id];
  state.primarySelectedId = node.id;
  state.selectedEdgeId = null;
  render();
  return node;
}
function addChildNode() {
  const base = getPrimaryNode();
  if (!base) return;
  commitHistory();
  const child = addNodeAt(base.x + base.w + 80, base.y, state.shapeToAdd);
  state.edges.push(createEdge(base.id, child.id, connectorTypeEl.value, { fromSide: 'right', toSide: 'left' }));
  resolveInsertedNodeOverlap(child, 'right');
  render();
  openFloatingEditorForNode(child);
}
function addSiblingBelowNode() {
  const base = getPrimaryNode();
  if (!base) return;
  const parentEdge = state.edges.find((e) => e.to === base.id);
  const parentId = parentEdge?.from || base.id;
  const parent = getNode(parentId);
  if (!parent) return;
  commitHistory();
  const sibling = addNodeAt(base.x, base.y + Math.max(base.h, 60) + 70, state.shapeToAdd);
  state.edges.push(createEdge(parent.id, sibling.id, connectorTypeEl.value, { fromSide: 'right', toSide: 'left' }));
  resolveInsertedNodeOverlap(sibling, 'down');
  render();
  openFloatingEditorForNode(sibling);
}
function connectNodes(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  if (state.edges.some((e) => e.from === fromId && e.to === toId)) return;
  state.edges.push(createEdge(fromId, toId));
  render();
}

function moveGroupMembers(ids, diffX, diffY) {
  const groups = new Set(ids.map((id) => getNode(id)?.groupId).filter(Boolean));
  groups.forEach((groupId) => {
    state.nodes.filter((n) => n.groupId === groupId && !ids.includes(n.id)).forEach((n) => {
      n.x = maybeSnap(n.x + diffX);
      n.y = maybeSnap(n.y + diffY);
    });
  });
}
function calculateGuidedPosition(targetId, proposedX, proposedY) {
  state.guides = [];
  if (!guideToggle.checked) return { x: proposedX, y: proposedY };
  const target = getNode(targetId);
  const others = state.nodes.filter((n) => !state.selectedIds.includes(n.id) && getLayer(n.layerId)?.visible !== false);
  if (!target) return { x: proposedX, y: proposedY };
  const threshold = 8;
  const candidate = { ...target, x: proposedX, y: proposedY };
  const cb = boundsOfNode(candidate);
  const xs = [cb.left, cb.cx, cb.right];
  const ys = [cb.top, cb.cy, cb.bottom];
  let bestX = null;
  let bestY = null;
  for (const o of others) {
    const ob = boundsOfNode(o);
    const ox = [ob.left, ob.cx, ob.right];
    const oy = [ob.top, ob.cy, ob.bottom];
    xs.forEach((a) => ox.forEach((b) => {
      const d = b - a;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.diff))) bestX = { diff: d, value: b };
    }));
    ys.forEach((a) => oy.forEach((b) => {
      const d = b - a;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.diff))) bestY = { diff: d, value: b };
    }));
  }
  let x = proposedX;
  let y = proposedY;
  const vb = visibleWorldBounds();
  if (bestX) {
    x += bestX.diff;
    state.guides.push({ x1: bestX.value, y1: vb.top, x2: bestX.value, y2: vb.bottom });
  }
  if (bestY) {
    y += bestY.diff;
    state.guides.push({ x1: vb.left, y1: bestY.value, x2: vb.right, y2: bestY.value });
  }
  return { x, y };
}

function applyAlignment(type) {
  const nodes = state.selectedIds.map(getNode).filter(Boolean);
  if (nodes.length < 2) return;
  commitHistory();
  const ref = getPrimaryNode() || nodes[0];
  if (type === 'left') nodes.forEach((n) => { n.x = ref.x - ref.w / 2 + n.w / 2; });
  if (type === 'center') nodes.forEach((n) => { n.x = ref.x; });
  if (type === 'right') nodes.forEach((n) => { n.x = ref.x + ref.w / 2 - n.w / 2; });
  if (type === 'top') nodes.forEach((n) => { n.y = ref.y - ref.h / 2 + n.h / 2; });
  if (type === 'middle') nodes.forEach((n) => { n.y = ref.y; });
  if (type === 'bottom') nodes.forEach((n) => { n.y = ref.y + ref.h / 2 - n.h / 2; });
  nodes.forEach((n) => { n.x = maybeSnap(n.x); n.y = maybeSnap(n.y); });
  render();
}
function distribute(axis) {
  const nodes = state.selectedIds.map(getNode).filter(Boolean);
  if (nodes.length < 3) return;
  commitHistory();
  const sorted = [...nodes].sort((a, b) => axis === 'h' ? a.x - b.x : a.y - b.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = axis === 'h' ? (last.x - first.x) : (last.y - first.y);
  const step = span / (sorted.length - 1 || 1);
  sorted.forEach((n, i) => {
    if (axis === 'h') n.x = maybeSnap(first.x + step * i);
    else n.y = maybeSnap(first.y + step * i);
  });
  render();
}
function sameSize() {
  const nodes = state.selectedIds.map(getNode).filter(Boolean);
  const ref = getPrimaryNode();
  if (!ref || nodes.length < 2) return;
  commitHistory();
  nodes.forEach((n) => {
    if (n.id !== ref.id) {
      n.w = ref.w;
      n.h = ref.h;
    }
  });
  render();
}
function duplicateSelection() {
  if (!state.selectedIds.length) return;
  commitHistory();
  const map = new Map();
  const newIds = [];
  state.selectedIds.forEach((id) => {
    const n = getNode(id);
    if (!n) return;
    const c = { ...n, id: uid('n'), x: n.x + 40, y: n.y + 40, z: nextZ(), label: `${n.label} コピー` };
    state.nodes.push(c);
    map.set(id, c.id);
    newIds.push(c.id);
  });
  state.edges.slice().forEach((e) => {
    if (map.has(e.from) && map.has(e.to)) state.edges.push({ ...e, id: uid('e'), from: map.get(e.from), to: map.get(e.to) });
  });
  state.selectedIds = newIds;
  state.primarySelectedId = newIds[0] || null;
  state.selectedEdgeId = null;
  render();
}
function removeSelection() {
  if (state.selectedIds.length) {
    commitHistory();
    const ids = new Set(state.selectedIds);
    state.nodes = state.nodes.filter((n) => !ids.has(n.id));
    state.edges = state.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
    state.groups = state.groups.filter((g) => !g.nodeIds.some((id) => ids.has(id)));
    clearSelection();
    render();
    return;
  }
  if (state.selectedEdgeId) {
    commitHistory();
    state.edges = state.edges.filter((e) => e.id !== state.selectedEdgeId);
    state.selectedEdgeId = null;
    render();
  }
}
function groupSelection() {
  if (state.selectedIds.length < 2) return;
  commitHistory();
  const groupId = uid('g');
  state.groups.push({ id: groupId, nodeIds: [...state.selectedIds] });
  state.selectedIds.forEach((id) => {
    const n = getNode(id);
    if (n) n.groupId = groupId;
  });
  render();
  setStatus('グループ化しました');
}
function ungroupSelection() {
  if (!state.selectedIds.length) return;
  commitHistory();
  const groupIds = new Set(state.selectedIds.map((id) => getNode(id)?.groupId).filter(Boolean));
  state.groups = state.groups.filter((g) => !groupIds.has(g.id));
  state.nodes.forEach((n) => { if (groupIds.has(n.groupId)) n.groupId = null; });
  render();
  setStatus('グループ解除しました');
}
function bringFront() {
  if (!state.selectedIds.length) return;
  commitHistory();
  state.selectedIds.forEach((id) => {
    const n = getNode(id);
    if (n) n.z = nextZ();
  });
  render();
}
function sendBack() {
  if (!state.selectedIds.length) return;
  commitHistory();
  let minZ = Math.min(...state.nodes.map((n) => n.z || 0), 0) - 1;
  state.selectedIds.forEach((id) => {
    const n = getNode(id);
    if (n) n.z = minZ--;
  });
  render();
}
function makeContainerFromSelection() {
  if (!state.selectedIds.length) return;
  commitHistory();
  const nodes = state.selectedIds.map(getNode).filter(Boolean);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  nodes.forEach((n) => {
    const b = boundsOfNode(n);
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  });
  const pad = 40;
  const container = {
    id: uid('n'),
    x: maybeSnap((left + right) / 2),
    y: maybeSnap((top + bottom) / 2),
    w: maybeSnap((right - left) + pad * 2),
    h: maybeSnap((bottom - top) + pad * 2),
    label: 'Container',
    type: 'container',
    z: Math.min(...nodes.map((n) => n.z || 0)) - 1,
    layerId: state.activeLayerId,
    groupId: null,
  };
  state.nodes.push(container);
  state.selectedIds = [container.id];
  state.primarySelectedId = container.id;
  render();
}

function addLayer() {
  commitHistory();
  const name = prompt('レイヤー名', `Layer ${state.layers.length + 1}`);
  if (!name) return;
  const layer = { id: uid('layer'), name, visible: true, locked: false };
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  render();
}
function renameLayer() {
  const layer = getLayer(state.activeLayerId);
  if (!layer) return;
  const name = prompt('新しいレイヤー名', layer.name);
  if (!name) return;
  commitHistory();
  layer.name = name;
  render();
}

function openFloatingEditor(node, clientX, clientY) {
  state.editingNodeId = node.id;
  floatingText.value = node.label;
  const rect = svg.getBoundingClientRect();
  floatingEditor.style.left = `${Math.min(rect.width - 340, clientX - rect.left + 10)}px`;
  floatingEditor.style.top = `${Math.min(rect.height - 180, clientY - rect.top + 10)}px`;
  floatingEditor.style.display = 'block';
  floatingText.focus();
  floatingText.select();
}
function openFloatingEditorForNode(node) {
  const rect = svg.getBoundingClientRect();
  const clientX = rect.left + ((node.x - state.view.x) * state.view.scale);
  const clientY = rect.top + ((node.y - state.view.y) * state.view.scale);
  openFloatingEditor(node, clientX, clientY);
}
function closeFloatingEditor() {
  floatingEditor.style.display = 'none';
  state.editingNodeId = null;
}
function applyInspectorChanges(commit = false) {
  const node = getPrimaryNode();
  if (!node) return;
  if (commit) commitHistory();
  const nextLabel = selectedLabel.value.trim();
  node.label = nextLabel || node.label;
  node.w = clamp(parseInt(selectedW.value || node.w, 10) || node.w, 60, 700);
  node.h = clamp(parseInt(selectedH.value || node.h, 10) || node.h, 36, 500);
  node.fill = selectedFill.value || node.fill || '#192447';
  node.stroke = selectedStroke.value || node.stroke || '#7389df';
  node.textColor = selectedTextColor.value || node.textColor || '#ffffff';
  node.noStroke = !!selectedNoStroke.checked;
  node.type = selectedType.value;
  node.layerId = selectedLayer.value || node.layerId;
  render();
}
function beginInspectorEdit() {
  if (state.inspectorEditing) return;
  state.inspectorEditing = true;
  commitHistory();
}
function endInspectorEdit() {
  state.inspectorEditing = false;
}
