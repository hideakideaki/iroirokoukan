const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('stage');
const viewport = document.getElementById('viewport');
const grid = document.getElementById('grid');
const majorGrid = document.getElementById('majorGrid');
const guidesLayer = document.getElementById('guidesLayer');
const nodesLayer = document.getElementById('nodesLayer');
const edgesLayer = document.getElementById('edgesLayer');
const tempLayer = document.getElementById('tempLayer');
const selectionLayer = document.getElementById('selectionLayer');
const miniContent = document.getElementById('miniContent');
const miniViewport = document.getElementById('miniViewport');

const leftbar = document.getElementById('leftbar');
const rightbar = document.getElementById('rightbar');
const statusEl = document.getElementById('status');
const modeChips = document.getElementById('modeChips');
const shapeLibrary = document.getElementById('shapeLibrary');
const connectorTypeEl = document.getElementById('connectorType');
const selectedLabel = document.getElementById('selectedLabel');
const selectedW = document.getElementById('selectedW');
const selectedH = document.getElementById('selectedH');
const selectedFill = document.getElementById('selectedFill');
const selectedStroke = document.getElementById('selectedStroke');
const selectedTextColor = document.getElementById('selectedTextColor');
const selectedNoStroke = document.getElementById('selectedNoStroke');
const selectedType = document.getElementById('selectedType');
const selectedLayer = document.getElementById('selectedLayer');
const selectionList = document.getElementById('selectionList');
const layerList = document.getElementById('layerList');
const fileInput = document.getElementById('fileInput');
const floatingEditor = document.getElementById('floatingEditor');
const floatingText = document.getElementById('floatingText');
const snapToggle = document.getElementById('snapToggle');
const guideToggle = document.getElementById('guideToggle');
const portToggle = document.getElementById('portToggle');
const moveChildrenToggle = document.getElementById('moveChildrenToggle');

const GRID = 20;
const MAJOR_GRID = 100;
const PORT_VECTORS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const state = {
  mode: 'select',
  shapeToAdd: 'mind',
  nodes: [],
  edges: [],
  layers: [
    { id: 'layer_default', name: 'Default', visible: true, locked: false },
    { id: 'layer_notes', name: 'Notes', visible: true, locked: false },
  ],
  activeLayerId: 'layer_default',
  groups: [],
  selectedIds: [],
  primarySelectedId: null,
  selectedEdgeId: null,
  connectFrom: null,
  draggingNodeIds: null,
  dragRootIds: null,
  resizingNodeId: null,
  resizingStart: null,
  draggingCanvas: false,
  draggingEdgeHandle: null,
  inspectorEditing: false,
  pointerDownInfo: null,
  lastNodeClick: null,
  selectionRect: null,
  dragOrigins: null,
  dragStartWorld: null,
  view: { x: -400, y: -300, scale: 1 },
  idSeq: 1,
  editingNodeId: null,
  lastBrainstormNodeId: null,
  tempMouse: null,
  guides: [],
  history: [],
  future: [],
};

function uid(prefix) { return `${prefix}_${state.idSeq++}`; }
function createSvg(name) { return document.createElementNS(SVG_NS, name); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function roundGrid(v) { return Math.round(v / GRID) * GRID; }
function maybeSnap(v) { return snapToggle.checked ? roundGrid(v) : v; }
function setStatus(text, warn = false) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('warn', !!warn);
}
function getNode(id) { return state.nodes.find((n) => n.id === id); }
function getEdge(id) { return state.edges.find((e) => e.id === id); }
function getLayer(id) { return state.layers.find((l) => l.id === id); }
function getPrimaryNode() { return state.primarySelectedId ? getNode(state.primarySelectedId) : null; }
function isSelected(id) { return state.selectedIds.includes(id); }
function visibleWorldBounds() {
  const rect = svg.getBoundingClientRect();
  return {
    left: state.view.x,
    top: state.view.y,
    right: state.view.x + rect.width / state.view.scale,
    bottom: state.view.y + rect.height / state.view.scale,
  };
}
function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / state.view.scale + state.view.x,
    y: (clientY - rect.top) / state.view.scale + state.view.y,
  };
}

function snapshot() {
  return JSON.stringify({
    nodes: state.nodes,
    edges: state.edges,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    groups: state.groups,
    view: state.view,
    idSeq: state.idSeq,
    selectedIds: state.selectedIds,
    primarySelectedId: state.primarySelectedId,
    selectedEdgeId: state.selectedEdgeId,
  });
}
function restore(json) {
  const s = JSON.parse(json);
  state.nodes = s.nodes || [];
  state.edges = s.edges || [];
  state.layers = s.layers || [{ id: 'layer_default', name: 'Default', visible: true, locked: false }];
  state.activeLayerId = s.activeLayerId || state.layers[0]?.id;
  state.groups = s.groups || [];
  state.view = s.view || { x: -400, y: -300, scale: 1 };
  state.idSeq = s.idSeq || 1;
  state.selectedIds = s.selectedIds || [];
  state.primarySelectedId = s.primarySelectedId || null;
  state.selectedEdgeId = s.selectedEdgeId || null;
  normalizeEdges();
  render();
}
function commitHistory() {
  state.history.push(snapshot());
  if (state.history.length > 120) state.history.shift();
  state.future = [];
}
function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
  setStatus('Undoしました');
}
function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
  setStatus('Redoしました');
}

function clearSelection() {
  state.selectedIds = [];
  state.primarySelectedId = null;
  state.selectedEdgeId = null;
}
function setPrimarySelection(id, additive = false) {
  state.selectedEdgeId = null;
  if (!additive) state.selectedIds = [id];
  else if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
  state.primarySelectedId = id;
  render();
}
function toggleSelection(id) {
  state.selectedEdgeId = null;
  if (state.selectedIds.includes(id)) {
    state.selectedIds = state.selectedIds.filter((x) => x !== id);
    if (state.primarySelectedId === id) state.primarySelectedId = state.selectedIds[0] || null;
  } else {
    state.selectedIds.push(id);
    state.primarySelectedId = id;
  }
  render();
}

function boundsOfNode(n) {
  return { left: n.x - n.w / 2, right: n.x + n.w / 2, top: n.y - n.h / 2, bottom: n.y + n.h / 2, cx: n.x, cy: n.y };
}
function expandBounds(bounds, paddingX, paddingY = paddingX) {
  return {
    left: bounds.left - paddingX,
    right: bounds.right + paddingX,
    top: bounds.top - paddingY,
    bottom: bounds.bottom + paddingY,
  };
}
function boundsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function collectDescendantIds(rootId, acc = new Set()) {
  if (acc.has(rootId)) return acc;
  acc.add(rootId);
  state.edges.filter((edge) => edge.from === rootId).forEach((edge) => collectDescendantIds(edge.to, acc));
  return acc;
}
function collectDragNodeIds(baseIds) {
  const ids = new Set(baseIds);
  if (!moveChildrenToggle.checked) return [...ids];
  baseIds.forEach((id) => collectDescendantIds(id, ids));
  return [...ids];
}
function buildDragContext(rootIds) {
  const draggingNodeIds = collectDragNodeIds(rootIds);
  return {
    rootIds: [...rootIds],
    draggingNodeIds,
    dragOrigins: new Map(draggingNodeIds.map((id) => [id, { x: getNode(id).x, y: getNode(id).y }])),
  };
}
function shiftNodeSet(nodeIds, dx, dy) {
  nodeIds.forEach((id) => {
    const node = getNode(id);
    if (!node) return;
    node.x = maybeSnap(node.x + dx);
    node.y = maybeSnap(node.y + dy);
  });
}
function collectPushLaneIds(insertedNode, direction) {
  const expanded = expandBounds(boundsOfNode(insertedNode), 28, 28);
  const ids = new Set();
  for (const node of state.nodes) {
    if (node.id === insertedNode.id) continue;
    const bounds = boundsOfNode(node);
    if (direction === 'right') {
      const sameBand = bounds.bottom > expanded.top && bounds.top < expanded.bottom;
      const isAhead = bounds.cx >= insertedNode.x;
      if (sameBand && isAhead) collectDescendantIds(node.id, ids);
    } else {
      const sameBand = bounds.right > expanded.left && bounds.left < expanded.right;
      const isAhead = bounds.cy >= insertedNode.y;
      if (sameBand && isAhead) collectDescendantIds(node.id, ids);
    }
  }
  return ids;
}
function resolveInsertedNodeOverlap(insertedNode, direction) {
  const shiftX = direction === 'right' ? maybeSnap(insertedNode.w + 80) : 0;
  const shiftY = direction === 'down' ? maybeSnap(insertedNode.h + 70) : 0;
  if (!shiftX && !shiftY) return;
  let moved = true;
  while (moved) {
    moved = false;
    const laneIds = collectPushLaneIds(insertedNode, direction);
    if (!laneIds.size) break;
    const targetBounds = expandBounds(boundsOfNode(insertedNode), 24, 24);
    const overlapping = [...laneIds].some((id) => {
      const node = getNode(id);
      return node && boundsIntersect(targetBounds, boundsOfNode(node));
    });
    if (!overlapping) break;
    shiftNodeSet(laneIds, shiftX, shiftY);
    moved = true;
  }
}
function wrapText(text, maxCharsPerLine = 12) {
  const lines = [];
  const raw = String(text || '').split(/\n/);
  for (const part of raw) {
    if (!part) {
      lines.push('');
      continue;
    }
    let s = part;
    while (s.length > maxCharsPerLine) {
      lines.push(s.slice(0, maxCharsPerLine));
      s = s.slice(maxCharsPerLine);
    }
    lines.push(s);
  }
  return lines.slice(0, 5);
}
function roundedRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  return [`M ${x + rr} ${y}`, `H ${x + w - rr}`, `Q ${x + w} ${y} ${x + w} ${y + rr}`, `V ${y + h - rr}`, `Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`, `H ${x + rr}`, `Q ${x} ${y + h} ${x} ${y + h - rr}`, `V ${y + rr}`, `Q ${x} ${y} ${x + rr} ${y}`, 'Z'].join(' ');
}
function shapePath(node) {
  const x = node.x - node.w / 2;
  const y = node.y - node.h / 2;
  if (node.type === 'decision') return `M ${node.x} ${y} L ${x + node.w} ${node.y} L ${node.x} ${y + node.h} L ${x} ${node.y} Z`;
  if (node.type === 'start') return roundedRectPath(x, y, node.w, node.h, node.h / 2);
  return roundedRectPath(x, y, node.w, node.h, 16);
}
function getPorts(node) {
  return {
    top: { x: node.x, y: node.y - node.h / 2 },
    right: { x: node.x + node.w / 2, y: node.y },
    bottom: { x: node.x, y: node.y + node.h / 2 },
    left: { x: node.x - node.w / 2, y: node.y },
  };
}
function inferPortSides(fromNode, toNode) {
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  }
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}
function normalizeEdge(edge) {
  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  if (!fromNode || !toNode) return edge;
  const inferred = inferPortSides(fromNode, toNode);
  return {
    ...edge,
    fromSide: edge.fromSide || inferred.fromSide,
    toSide: edge.toSide || inferred.toSide,
  };
}
function normalizeEdges() {
  state.edges = state.edges.map(normalizeEdge);
}
function getPortPoint(node, side) {
  const ports = getPorts(node);
  return ports[side] || ports.right;
}
function offsetPoint(point, side, distance) {
  const vector = PORT_VECTORS[side] || PORT_VECTORS.right;
  return {
    x: point.x + vector.x * distance,
    y: point.y + vector.y * distance,
  };
}
function orthogonalPath(start, end, fromSide, toSide) {
  const startOuter = offsetPoint(start, fromSide, 26);
  const endOuter = offsetPoint(end, toSide, 26);
  if (startOuter.x === endOuter.x || startOuter.y === endOuter.y) {
    return `M ${start.x} ${start.y} L ${startOuter.x} ${startOuter.y} L ${endOuter.x} ${endOuter.y} L ${end.x} ${end.y}`;
  }
  const isHorizontalPair = (fromSide === 'right' && toSide === 'left') || (fromSide === 'left' && toSide === 'right');
  const isVerticalPair = (fromSide === 'top' && toSide === 'bottom') || (fromSide === 'bottom' && toSide === 'top');
  if (isHorizontalPair) {
    return `M ${start.x} ${start.y} L ${startOuter.x} ${startOuter.y} L ${endOuter.x} ${startOuter.y} L ${endOuter.x} ${endOuter.y} L ${end.x} ${end.y}`;
  }
  if (isVerticalPair) {
    return `M ${start.x} ${start.y} L ${startOuter.x} ${startOuter.y} L ${startOuter.x} ${endOuter.y} L ${endOuter.x} ${endOuter.y} L ${end.x} ${end.y}`;
  }
  const horizontalFirst = Math.abs(startOuter.x - endOuter.x) >= Math.abs(startOuter.y - endOuter.y);
  if (horizontalFirst) {
    const mx = (startOuter.x + endOuter.x) / 2;
    return `M ${start.x} ${start.y} L ${startOuter.x} ${startOuter.y} L ${mx} ${startOuter.y} L ${mx} ${endOuter.y} L ${endOuter.x} ${endOuter.y} L ${end.x} ${end.y}`;
  }
  const my = (startOuter.y + endOuter.y) / 2;
  return `M ${start.x} ${start.y} L ${startOuter.x} ${startOuter.y} L ${startOuter.x} ${my} L ${endOuter.x} ${my} L ${endOuter.x} ${endOuter.y} L ${end.x} ${end.y}`;
}
function bezierPath(start, end, fromSide, toSide) {
  const distance = clamp(Math.hypot(end.x - start.x, end.y - start.y) * 0.35, 36, 120);
  const c1 = offsetPoint(start, fromSide, distance);
  const c2 = offsetPoint(end, toSide, distance);
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}
function straightPath(start, end) { return `M ${start.x} ${start.y} L ${end.x} ${end.y}`; }
function edgePath(edge) {
  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  if (!fromNode || !toNode) return '';
  const normalized = normalizeEdge(edge);
  const start = getPortPoint(fromNode, normalized.fromSide);
  const end = getPortPoint(toNode, normalized.toSide);
  const type = edge.connector || 'orthogonal';
  if (type === 'straight') return straightPath(start, end);
  if (type === 'bezier') return bezierPath(start, end, normalized.fromSide, normalized.toSide);
  return orthogonalPath(start, end, normalized.fromSide, normalized.toSide);
}
function edgeMarker(edge) {
  const side = edge.toSide || 'left';
  const selected = state.selectedEdgeId === edge.id ? 'Selected' : '';
  const map = {
    left: 'arrowRight',
    right: 'arrowLeft',
    top: 'arrowDown',
    bottom: 'arrowUp',
  };
  return `url(#${map[side] || 'arrowRight'}${selected})`;
}
function createEdge(fromId, toId, connector = connectorTypeEl.value, sides = null) {
  const fromNode = getNode(fromId);
  const toNode = getNode(toId);
  const resolvedSides = sides || ((fromNode && toNode) ? inferPortSides(fromNode, toNode) : { fromSide: 'right', toSide: 'left' });
  return { id: uid('e'), from: fromId, to: toId, connector, fromSide: resolvedSides.fromSide, toSide: resolvedSides.toSide };
}
function getHitNode(target) {
  const el = target.closest('[data-kind="node"]');
  if (!el) return null;
  return getNode(el.dataset.id);
}
function getHitEdge(target) {
  const el = target.closest('[data-kind="edge"]');
  if (!el) return null;
  return getEdge(el.dataset.id);
}
function getResizeTarget(target) {
  const el = target.closest('[data-kind="resize"]');
  return el ? el.dataset.id : null;
}
function getEdgeHandleTarget(target) {
  const el = target.closest('[data-kind="edge-handle"]');
  if (!el) return null;
  return { edgeId: el.dataset.id, end: el.dataset.end };
}
function pointInsideNode(node, point) {
  const b = boundsOfNode(node);
  return point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom;
}
function getTopNodeAtPoint(point, excludedIds = []) {
  const excluded = new Set(excludedIds);
  return [...sortedVisibleNodes()]
    .reverse()
    .find((candidate) => !excluded.has(candidate.id) && pointInsideNode(candidate, point));
}
function nearestPortSide(node, point) {
  const ports = getPorts(node);
  let bestSide = 'right';
  let bestDistance = Infinity;
  Object.entries(ports).forEach(([side, port]) => {
    const dx = port.x - point.x;
    const dy = port.y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSide = side;
    }
  });
  return bestSide;
}
function retargetEdgeHandle(edge, end, point) {
  const node = [...sortedVisibleNodes()].reverse().find((candidate) => pointInsideNode(candidate, point));
  if (!node) return false;
  const side = nearestPortSide(node, point);
  if (end === 'from') {
    if (node.id === edge.to) return false;
    edge.from = node.id;
    edge.fromSide = side;
  } else {
    if (node.id === edge.from) return false;
    edge.to = node.id;
    edge.toSide = side;
  }
  return true;
}
