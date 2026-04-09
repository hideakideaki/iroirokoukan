let autosaveTimer = null;

function serialize() {
  return {
    version: 3,
    nodes: state.nodes,
    edges: state.edges,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    groups: state.groups,
    idSeq: state.idSeq,
    view: state.view,
  };
}
function formatTimestamp(date = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function downloadText(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
function mermaidSafeId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_]/g, '_') || uid('node');
}
function escapeMermaidLabel(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '<br/>');
}
function mermaidNodeSyntax(node, id) {
  const label = escapeMermaidLabel(node.label);
  if (node.type === 'decision') return `${id}{"${label}"}`;
  if (node.type === 'start') return `${id}(["${label}"])`;
  return `${id}["${label}"]`;
}
function exportMermaid() {
  const nodeIds = new Map();
  const used = new Set();
  state.nodes.forEach((node) => {
    let id = mermaidSafeId(node.id);
    while (used.has(id)) id = `${id}_${used.size}`;
    used.add(id);
    nodeIds.set(node.id, id);
  });
  const lines = ['flowchart TD'];
  state.nodes.forEach((node) => {
    lines.push(`  ${mermaidNodeSyntax(node, nodeIds.get(node.id))}`);
  });
  state.edges.forEach((edge) => {
    const fromId = nodeIds.get(edge.from);
    const toId = nodeIds.get(edge.to);
    if (fromId && toId) lines.push(`  ${fromId} --> ${toId}`);
  });
  return lines.join('\n');
}
function sortNodesForTree(ids, nodeMap) {
  return [...ids].sort((a, b) => {
    const na = nodeMap.get(a);
    const nb = nodeMap.get(b);
    if (!na || !nb) return 0;
    if (na.y !== nb.y) return na.y - nb.y;
    return na.x - nb.x;
  });
}
function exportIndentedText() {
  const nodeMap = new Map(state.nodes.map((node) => [node.id, node]));
  const childMap = new Map(state.nodes.map((node) => [node.id, []]));
  const incoming = new Map(state.nodes.map((node) => [node.id, 0]));
  state.edges.forEach((edge) => {
    if (!childMap.has(edge.from) || !nodeMap.has(edge.to)) return;
    childMap.get(edge.from).push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
  });
  const roots = sortNodesForTree(
    state.nodes.filter((node) => (incoming.get(node.id) || 0) === 0).map((node) => node.id),
    nodeMap,
  );
  const lines = [];
  const visited = new Set();
  const walk = (id, depth) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    lines.push(`${'\t'.repeat(depth)}${String(node.label || '').replace(/\n/g, '\\n')}`);
    sortNodesForTree(childMap.get(id) || [], nodeMap).forEach((childId) => walk(childId, depth + 1));
  };
  roots.forEach((rootId) => walk(rootId, 0));
  sortNodesForTree(state.nodes.map((node) => node.id).filter((id) => !visited.has(id)), nodeMap).forEach((id) => walk(id, 0));
  return lines.join('\n');
}
function createEdgeBetweenNodes(fromNode, toNode, connector = 'orthogonal') {
  const sides = inferPortSides(fromNode, toNode);
  return { id: uid('e'), from: fromNode.id, to: toNode.id, connector, fromSide: sides.fromSide, toSide: sides.toSide };
}
function importIndentedText(text) {
  const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const parsed = rawLines
    .map((line) => {
      const match = line.match(/^(\t*)(.*)$/);
      const tabs = match ? match[1].length : 0;
      const content = (match ? match[2] : line).trimEnd();
      return { depth: tabs, label: content };
    })
    .filter((item) => item.label.trim().length);
  if (!parsed.length) throw new Error('No text nodes found');
  const nodes = [];
  const edges = [];
  const parentStack = [];
  const depthCounts = new Map();
  parsed.forEach((item) => {
    const depth = item.depth;
    const row = depthCounts.get(depth) || 0;
    depthCounts.set(depth, row + 1);
    const node = {
      id: uid('n'),
      x: maybeSnap(depth * 240),
      y: maybeSnap(row * 120),
      w: 150,
      h: 60,
      label: item.label.replace(/\\n/g, '\n'),
      type: 'mind',
      z: nextZ() + nodes.length + 1,
      layerId: 'layer_default',
      groupId: null,
    };
    nodes.push(node);
    parentStack[depth] = node;
    parentStack.length = depth + 1;
    if (depth > 0 && parentStack[depth - 1]) {
      edges.push(createEdgeBetweenNodes(parentStack[depth - 1], node, 'orthogonal'));
    }
  });
  loadData({
    version: 3,
    nodes,
    edges,
    layers: [{ id: 'layer_default', name: 'Default', visible: true, locked: false }],
    activeLayerId: 'layer_default',
    groups: [],
    idSeq: state.idSeq,
    view: { x: -160, y: -120, scale: 1 },
  });
}
function parseMermaidEndpoint(spec) {
  const trimmed = spec.trim().replace(/;$/, '');
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (!match) return null;
  const id = match[1];
  const rest = match[2].trim();
  let type = 'mind';
  let label = id;
  let labelMatch = rest.match(/^\[\("([\s\S]*)"\)\]$/);
  if (labelMatch) {
    type = 'start';
    label = labelMatch[1];
  } else {
    labelMatch = rest.match(/^\(\["([\s\S]*)"\]\)$/);
    if (labelMatch) {
      type = 'start';
      label = labelMatch[1];
    } else {
      labelMatch = rest.match(/^\{"([\s\S]*)"\}$/);
      if (labelMatch) {
        type = 'decision';
        label = labelMatch[1];
      } else {
        labelMatch = rest.match(/^\["([\s\S]*)"\]$/);
        if (labelMatch) label = labelMatch[1];
      }
    }
  }
  return { id, label: label.replace(/<br\s*\/?>/gi, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'), type };
}
function importMermaid(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('%%'));
  const nodesByKey = new Map();
  const edges = [];
  const ensureNode = (endpoint) => {
    if (!endpoint) return null;
    if (!nodesByKey.has(endpoint.id)) nodesByKey.set(endpoint.id, endpoint);
    else {
      const existing = nodesByKey.get(endpoint.id);
      existing.label = endpoint.label || existing.label;
      existing.type = endpoint.type || existing.type;
    }
    return nodesByKey.get(endpoint.id);
  };
  const edgePattern = /(.*?)\s*(?:-->|---|-.->|==>)\s*(.*)/;
  for (const line of lines) {
    if (/^(flowchart|graph)\b/i.test(line)) continue;
    const edgeMatch = line.match(edgePattern);
    if (edgeMatch) {
      const from = ensureNode(parseMermaidEndpoint(edgeMatch[1]));
      const to = ensureNode(parseMermaidEndpoint(edgeMatch[2]));
      if (from && to) edges.push({ from: from.id, to: to.id });
      continue;
    }
    ensureNode(parseMermaidEndpoint(line));
  }
  const importedKeys = [...nodesByKey.keys()];
  if (!importedKeys.length) throw new Error('No mermaid nodes found');
  const incoming = new Map(importedKeys.map((key) => [key, 0]));
  const children = new Map(importedKeys.map((key) => [key, []]));
  edges.forEach(({ from, to }) => {
    incoming.set(to, (incoming.get(to) || 0) + 1);
    children.get(from)?.push(to);
  });
  const roots = importedKeys.filter((key) => (incoming.get(key) || 0) === 0);
  const orderedRoots = roots.length ? roots : [importedKeys[0]];
  const levelMap = new Map();
  const queue = orderedRoots.map((key) => ({ key, level: 0 }));
  while (queue.length) {
    const { key, level } = queue.shift();
    if (levelMap.has(key)) continue;
    levelMap.set(key, level);
    (children.get(key) || []).forEach((child) => queue.push({ key: child, level: level + 1 }));
  }
  importedKeys.forEach((key) => { if (!levelMap.has(key)) levelMap.set(key, 0); });
  const levelSlots = new Map();
  const nodeIdMap = new Map();
  const nodes = importedKeys.map((key) => {
    const imported = nodesByKey.get(key);
    const level = levelMap.get(key) || 0;
    const slot = levelSlots.get(level) || 0;
    levelSlots.set(level, slot + 1);
    const node = {
      id: uid('n'),
      x: maybeSnap(level * 240),
      y: maybeSnap(slot * 130),
      w: imported.type === 'decision' ? 140 : imported.type === 'start' ? 170 : 150,
      h: imported.type === 'decision' ? 90 : imported.type === 'start' ? 54 : 60,
      label: imported.label || key,
      type: imported.type || 'mind',
      z: nextZ() + level + slot,
      layerId: state.activeLayerId,
      groupId: null,
    };
    nodeIdMap.set(key, node.id);
    return node;
  });
  const importedEdges = edges
    .map(({ from, to }) => {
      const fromId = nodeIdMap.get(from);
      const toId = nodeIdMap.get(to);
      return fromId && toId ? createEdge(fromId, toId, 'orthogonal') : null;
    })
    .filter(Boolean);
  loadData({
    version: 3,
    nodes,
    edges: importedEdges,
    layers: [{ id: 'layer_default', name: 'Default', visible: true, locked: false }],
    activeLayerId: 'layer_default',
    groups: [],
    idSeq: state.idSeq,
    view: { x: -160, y: -120, scale: 1 },
  });
}
function loadData(data) {
  state.nodes = Array.isArray(data.nodes)
    ? data.nodes.map((node) => ({
      fill: '#192447',
      stroke: '#7389df',
      textColor: '#ffffff',
      noStroke: false,
      ...node,
    }))
    : [];
  state.edges = Array.isArray(data.edges) ? data.edges : [];
  state.layers = Array.isArray(data.layers) && data.layers.length ? data.layers : [{ id: 'layer_default', name: 'Default', visible: true, locked: false }];
  state.activeLayerId = data.activeLayerId || state.layers[0].id;
  state.groups = Array.isArray(data.groups) ? data.groups : [];
  state.idSeq = data.idSeq || 1;
  state.view = data.view || { x: -400, y: -300, scale: 1 };
  state.selectedIds = state.nodes[0] ? [state.nodes[0].id] : [];
  state.primarySelectedId = state.nodes[0]?.id || null;
  state.selectedEdgeId = null;
  state.history = [];
  state.future = [];
  normalizeEdges();
  render();
}
function downloadJson() {
  downloadText(JSON.stringify(serialize(), null, 2), `diagram_${formatTimestamp()}.json`, 'application/json');
  setStatus('JSONを保存しました');
}
function downloadMermaid() {
  downloadText(exportMermaid(), `diagram_${formatTimestamp()}.mmd`, 'text/plain;charset=utf-8');
  setStatus('Mermaidを保存しました');
}
function downloadIndentedText() {
  downloadText(exportIndentedText(), `diagram_${formatTimestamp()}.txt`, 'text/plain;charset=utf-8');
  setStatus('テキストを保存しました');
}
function saveLocal() {
  localStorage.setItem('diagram_editor_data_v3', JSON.stringify(serialize()));
  setStatus('ブラウザに保存しました');
}
function loadLocal() {
  const raw = localStorage.getItem('diagram_editor_data_v3') || localStorage.getItem('diagram_editor_data_v2') || localStorage.getItem('diagram_editor_data_v1');
  if (!raw) return setStatus('保存データがありません', true);
  try {
    loadData(JSON.parse(raw));
    setStatus('ブラウザ保存を読み込みました');
  } catch {
    setStatus('保存データの読み込みに失敗しました', true);
  }
}
function saveAutosnapshot() {
  try {
    localStorage.setItem('diagram_editor_autosave_v3', JSON.stringify(serialize()));
  } catch {}
}
function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    saveAutosnapshot();
  }, 120);
}
function loadAutosnapshot() {
  const raw = localStorage.getItem('diagram_editor_autosave_v3') || localStorage.getItem('diagram_editor_autosave_v2') || localStorage.getItem('diagram_editor_autosave_v1');
  if (!raw) return false;
  try {
    loadData(JSON.parse(raw));
    setStatus('前回の自動保存を復元しました');
    return true;
  } catch {
    return false;
  }
}
function getExportBounds() {
  const nodes = sortedVisibleNodes();
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    const b = boundsOfNode(node);
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.right);
    maxY = Math.max(maxY, b.bottom);
  });
  const pad = 48;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
function buildExportSvg() {
  const bounds = getExportBounds();
  if (!bounds) return null;
  const clone = svg.cloneNode(true);
  clone.querySelector('#viewport')?.setAttribute('transform', '');
  clone.setAttribute('width', bounds.width);
  clone.setAttribute('height', bounds.height);
  clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  clone.querySelector('#tempLayer')?.replaceChildren();
  clone.querySelector('#selectionLayer')?.replaceChildren();
  const bg = createSvg('rect');
  bg.setAttribute('x', bounds.x);
  bg.setAttribute('y', bounds.y);
  bg.setAttribute('width', bounds.width);
  bg.setAttribute('height', bounds.height);
  bg.setAttribute('fill', '#0b1020');
  clone.insertBefore(bg, clone.firstChild);
  return { clone, bounds };
}
function buildExportSurface() {
  const exported = buildExportSvg();
  if (!exported) return null;
  const { clone, bounds } = exported;
  const surface = document.createElement('div');
  surface.style.position = 'fixed';
  surface.style.left = '-100000px';
  surface.style.top = '0';
  surface.style.width = `${Math.ceil(bounds.width)}px`;
  surface.style.height = `${Math.ceil(bounds.height)}px`;
  surface.style.background = '#0b1020';
  surface.style.overflow = 'hidden';
  surface.style.pointerEvents = 'none';
  surface.style.zIndex = '-1';
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.display = 'block';
  surface.appendChild(clone);
  return { surface, bounds };
}
function exportSvg() {
  const exported = buildExportSvg();
  if (!exported) {
    setStatus('書き出すノードがありません', true);
    return;
  }
  const { clone } = exported;
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `diagram_${formatTimestamp()}.svg`;
  a.click();
  setStatus('全ノードをSVGで書き出しました');
}
function exportPng() {
  if (typeof window.html2canvas !== 'function') {
    setStatus('PNG書き出しライブラリの読み込みに失敗しました', true);
    return;
  }
  const exported = buildExportSurface();
  if (!exported) {
    setStatus('書き出すノードがありません', true);
    return;
  }
  const { surface, bounds } = exported;
  document.body.appendChild(surface);
  window.html2canvas(surface, {
    backgroundColor: '#0b1020',
    useCORS: true,
    scale: 2,
    width: Math.ceil(bounds.width),
    height: Math.ceil(bounds.height),
  }).then((canvas) => {
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) {
        setStatus('PNG書き出しに失敗しました', true);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pngBlob);
      a.download = `diagram_${formatTimestamp()}.png`;
      a.click();
      setStatus('全ノードをPNGで書き出しました');
    });
  }).catch(() => {
    setStatus('PNG書き出しに失敗しました', true);
  }).finally(() => {
    surface.remove();
  });
}

function createInitial() {
  state.nodes = [
    { id: uid('n'), x: 0, y: 0, w: 160, h: 70, label: '中心トピック', type: 'mind', z: 1, layerId: 'layer_default', groupId: null, fill: '#192447', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    { id: uid('n'), x: -220, y: -110, w: 150, h: 60, label: '項目A', type: 'mind', z: 2, layerId: 'layer_default', groupId: null, fill: '#192447', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    { id: uid('n'), x: 220, y: -80, w: 150, h: 60, label: '項目B', type: 'mind', z: 3, layerId: 'layer_default', groupId: null, fill: '#192447', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
    { id: uid('n'), x: 250, y: 120, w: 150, h: 60, label: '項目C', type: 'mind', z: 4, layerId: 'layer_default', groupId: null, fill: '#192447', stroke: '#7389df', textColor: '#ffffff', noStroke: false },
  ];
  state.edges = [
    createEdge(state.nodes[0].id, state.nodes[1].id, 'orthogonal'),
    createEdge(state.nodes[0].id, state.nodes[2].id, 'orthogonal'),
    createEdge(state.nodes[0].id, state.nodes[3].id, 'orthogonal'),
  ];
  state.selectedIds = [state.nodes[0].id];
  state.primarySelectedId = state.nodes[0].id;
  state.selectedEdgeId = null;
  render();
}
