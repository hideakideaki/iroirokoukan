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
    function getNode(id) { return state.nodes.find(n => n.id === id); }
    function getEdge(id) { return state.edges.find(e => e.id === id); }
    function getLayer(id) { return state.layers.find(l => l.id === id); }
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
        state.selectedIds = state.selectedIds.filter(x => x !== id);
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
      state.edges.filter(edge => edge.from === rootId).forEach(edge => collectDescendantIds(edge.to, acc));
      return acc;
    }
    function shiftNodeSet(nodeIds, dx, dy) {
      nodeIds.forEach((id) => {
        const node = getNode(id);
        if (!node) return;
        node.x = maybeSnap(node.x + dx);
        node.y = maybeSnap(node.y + dy);
      });
    }
    function resolveInsertedNodeOverlap(insertedNode, direction) {
      const shiftX = direction === 'right' ? maybeSnap(insertedNode.w + 80) : 0;
      const shiftY = direction === 'down' ? maybeSnap(insertedNode.h + 70) : 0;
      if (!shiftX && !shiftY) return;
      const protectedIds = new Set([insertedNode.id]);
      let moved = true;
      while (moved) {
        moved = false;
        const targetBounds = expandBounds(boundsOfNode(insertedNode), 24, 24);
        for (const node of state.nodes) {
          if (protectedIds.has(node.id)) continue;
          if (!boundsIntersect(targetBounds, boundsOfNode(node))) continue;
          const subtreeIds = collectDescendantIds(node.id);
          subtreeIds.forEach((id) => protectedIds.add(id));
          shiftNodeSet(subtreeIds, shiftX, shiftY);
          moved = true;
        }
      }
    }
    function wrapText(text, maxCharsPerLine = 12) {
      const lines = [];
      const raw = String(text || '').split(/\n/);
      for (const part of raw) {
        if (!part) { lines.push(''); continue; }
        let s = part;
        while (s.length > maxCharsPerLine) { lines.push(s.slice(0, maxCharsPerLine)); s = s.slice(maxCharsPerLine); }
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
        return dx >= 0
          ? { fromSide: 'right', toSide: 'left' }
          : { fromSide: 'left', toSide: 'right' };
      }
      return dy >= 0
        ? { fromSide: 'bottom', toSide: 'top' }
        : { fromSide: 'top', toSide: 'bottom' };
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
        left.innerHTML = `<span>${layer.name}</span><span class="badge">${state.nodes.filter(n => n.layerId === layer.id).length}</span>`;
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
        line.setAttribute('x1', x); line.setAttribute('y1', sy); line.setAttribute('x2', x); line.setAttribute('y2', ey);
        grid.appendChild(line);
      }
      for (let y = sy; y <= ey; y += GRID) {
        const line = createSvg('line');
        line.setAttribute('x1', sx); line.setAttribute('y1', y); line.setAttribute('x2', ex); line.setAttribute('y2', y);
        grid.appendChild(line);
      }
      for (let x = Math.floor(b.left / MAJOR_GRID) * MAJOR_GRID; x <= Math.ceil(b.right / MAJOR_GRID) * MAJOR_GRID; x += MAJOR_GRID) {
        const line = createSvg('line');
        line.setAttribute('x1', x); line.setAttribute('y1', sy); line.setAttribute('x2', x); line.setAttribute('y2', ey);
        majorGrid.appendChild(line);
      }
      for (let y = Math.floor(b.top / MAJOR_GRID) * MAJOR_GRID; y <= Math.ceil(b.bottom / MAJOR_GRID) * MAJOR_GRID; y += MAJOR_GRID) {
        const line = createSvg('line');
        line.setAttribute('x1', sx); line.setAttribute('y1', y); line.setAttribute('x2', ex); line.setAttribute('y2', y);
        majorGrid.appendChild(line);
      }
    }
    function drawGuides() {
      guidesLayer.innerHTML = '';
      if (!guideToggle.checked) return;
      for (const g of state.guides) {
        const line = createSvg('line');
        line.setAttribute('class', 'guide');
        line.setAttribute('x1', g.x1); line.setAttribute('y1', g.y1); line.setAttribute('x2', g.x2); line.setAttribute('y2', g.y2);
        guidesLayer.appendChild(line);
      }
    }
    function sortedVisibleNodes() {
      return [...state.nodes].filter(n => getLayer(n.layerId)?.visible !== false).sort((a, b) => (a.z || 0) - (b.z || 0));
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
            c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 5);
            g.appendChild(c);
          }
        }
        if (node.id === state.primarySelectedId) {
          const h = createSvg('rect');
          h.setAttribute('class', 'handle');
          h.setAttribute('x', node.w / 2 - 8); h.setAttribute('y', node.h / 2 - 8);
          h.setAttribute('width', 12); h.setAttribute('height', 12); h.dataset.kind = 'resize'; h.dataset.id = node.id;
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
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => { minX = Math.min(minX, n.x - n.w / 2); minY = Math.min(minY, n.y - n.h / 2); maxX = Math.max(maxX, n.x + n.w / 2); maxY = Math.max(maxY, n.y + n.h / 2); });
      const pad = 80; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const scale = Math.min(210 / Math.max(1, maxX - minX), 140 / Math.max(1, maxY - minY));
      state.edges.forEach(e => {
        const a = getNode(e.from), b = getNode(e.to);
        if (!a || !b) return;
        const line = createSvg('line');
        line.setAttribute('x1', (a.x - minX) * scale); line.setAttribute('y1', (a.y - minY) * scale);
        line.setAttribute('x2', (b.x - minX) * scale); line.setAttribute('y2', (b.y - minY) * scale);
        line.setAttribute('stroke', '#7f8fca'); line.setAttribute('stroke-width', 1);
        miniContent.appendChild(line);
      });
      nodes.forEach(n => {
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
      saveAutosnapshot();
    }

    function setMode(mode) {
      state.mode = mode;
      [...modeChips.querySelectorAll('.chip')].forEach(chip => chip.classList.toggle('active', chip.dataset.mode === mode));
      state.connectFrom = null;
      render();
      setStatus(`モード: ${mode}`);
    }
    function setShapeToAdd(shape) {
      state.shapeToAdd = shape;
      [...shapeLibrary.querySelectorAll('.shape-card')].forEach(card => card.classList.toggle('active', card.dataset.shape === shape));
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
      const parentEdge = state.edges.find(e => e.to === base.id);
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
      if (state.edges.some(e => e.from === fromId && e.to === toId)) return;
      state.edges.push(createEdge(fromId, toId));
      render();
    }

    function moveGroupMembers(ids, diffX, diffY) {
      const groups = new Set(ids.map(id => getNode(id)?.groupId).filter(Boolean));
      groups.forEach(groupId => {
        state.nodes.filter(n => n.groupId === groupId && !ids.includes(n.id)).forEach(n => {
          n.x = maybeSnap(n.x + diffX);
          n.y = maybeSnap(n.y + diffY);
        });
      });
    }
    function calculateGuidedPosition(targetId, proposedX, proposedY) {
      state.guides = [];
      if (!guideToggle.checked) return { x: proposedX, y: proposedY };
      const target = getNode(targetId);
      const others = state.nodes.filter(n => !state.selectedIds.includes(n.id) && getLayer(n.layerId)?.visible !== false);
      if (!target) return { x: proposedX, y: proposedY };
      const threshold = 8;
      const candidate = { ...target, x: proposedX, y: proposedY };
      const cb = boundsOfNode(candidate);
      const xs = [cb.left, cb.cx, cb.right];
      const ys = [cb.top, cb.cy, cb.bottom];
      let bestX = null, bestY = null;
      for (const o of others) {
        const ob = boundsOfNode(o);
        const ox = [ob.left, ob.cx, ob.right];
        const oy = [ob.top, ob.cy, ob.bottom];
        xs.forEach(a => ox.forEach(b => { const d = b - a; if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.diff))) bestX = { diff: d, value: b }; }));
        ys.forEach(a => oy.forEach(b => { const d = b - a; if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.diff))) bestY = { diff: d, value: b }; }));
      }
      let x = proposedX, y = proposedY;
      const vb = visibleWorldBounds();
      if (bestX) { x += bestX.diff; state.guides.push({ x1: bestX.value, y1: vb.top, x2: bestX.value, y2: vb.bottom }); }
      if (bestY) { y += bestY.diff; state.guides.push({ x1: vb.left, y1: bestY.value, x2: vb.right, y2: bestY.value }); }
      return { x, y };
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
      const node = [...sortedVisibleNodes()].reverse().find(candidate => pointInsideNode(candidate, point));
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

    function applyAlignment(type) {
      const nodes = state.selectedIds.map(getNode).filter(Boolean);
      if (nodes.length < 2) return;
      commitHistory();
      const ref = getPrimaryNode() || nodes[0];
      if (type === 'left') nodes.forEach(n => n.x = ref.x - ref.w / 2 + n.w / 2);
      if (type === 'center') nodes.forEach(n => n.x = ref.x);
      if (type === 'right') nodes.forEach(n => n.x = ref.x + ref.w / 2 - n.w / 2);
      if (type === 'top') nodes.forEach(n => n.y = ref.y - ref.h / 2 + n.h / 2);
      if (type === 'middle') nodes.forEach(n => n.y = ref.y);
      if (type === 'bottom') nodes.forEach(n => n.y = ref.y + ref.h / 2 - n.h / 2);
      nodes.forEach(n => { n.x = maybeSnap(n.x); n.y = maybeSnap(n.y); });
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
      sorted.forEach((n, i) => { if (axis === 'h') n.x = maybeSnap(first.x + step * i); else n.y = maybeSnap(first.y + step * i); });
      render();
    }
    function sameSize() {
      const nodes = state.selectedIds.map(getNode).filter(Boolean);
      const ref = getPrimaryNode();
      if (!ref || nodes.length < 2) return;
      commitHistory();
      nodes.forEach(n => { if (n.id !== ref.id) { n.w = ref.w; n.h = ref.h; } });
      render();
    }
    function duplicateSelection() {
      if (!state.selectedIds.length) return;
      commitHistory();
      const map = new Map();
      const newIds = [];
      state.selectedIds.forEach(id => {
        const n = getNode(id);
        if (!n) return;
        const c = { ...n, id: uid('n'), x: n.x + 40, y: n.y + 40, z: nextZ(), label: n.label + ' コピー' };
        state.nodes.push(c);
        map.set(id, c.id);
        newIds.push(c.id);
      });
      state.edges.slice().forEach(e => { if (map.has(e.from) && map.has(e.to)) state.edges.push({ ...e, id: uid('e'), from: map.get(e.from), to: map.get(e.to) }); });
      state.selectedIds = newIds;
      state.primarySelectedId = newIds[0] || null;
      state.selectedEdgeId = null;
      render();
    }
    function removeSelection() {
      if (state.selectedIds.length) {
        commitHistory();
        const ids = new Set(state.selectedIds);
        state.nodes = state.nodes.filter(n => !ids.has(n.id));
        state.edges = state.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
        state.groups = state.groups.filter(g => !g.nodeIds.some(id => ids.has(id)));
        clearSelection();
        render();
        return;
      }
      if (state.selectedEdgeId) {
        commitHistory();
        state.edges = state.edges.filter(e => e.id !== state.selectedEdgeId);
        state.selectedEdgeId = null;
        render();
      }
    }
    function groupSelection() {
      if (state.selectedIds.length < 2) return;
      commitHistory();
      const groupId = uid('g');
      state.groups.push({ id: groupId, nodeIds: [...state.selectedIds] });
      state.selectedIds.forEach(id => { const n = getNode(id); if (n) n.groupId = groupId; });
      render();
      setStatus('グループ化しました');
    }
    function ungroupSelection() {
      if (!state.selectedIds.length) return;
      commitHistory();
      const groupIds = new Set(state.selectedIds.map(id => getNode(id)?.groupId).filter(Boolean));
      state.groups = state.groups.filter(g => !groupIds.has(g.id));
      state.nodes.forEach(n => { if (groupIds.has(n.groupId)) n.groupId = null; });
      render();
      setStatus('グループ解除しました');
    }
    function bringFront() {
      if (!state.selectedIds.length) return;
      commitHistory();
      state.selectedIds.forEach(id => { const n = getNode(id); if (n) n.z = nextZ(); });
      render();
    }
    function sendBack() {
      if (!state.selectedIds.length) return;
      commitHistory();
      let minZ = Math.min(...state.nodes.map(n => n.z || 0), 0) - 1;
      state.selectedIds.forEach(id => { const n = getNode(id); if (n) n.z = minZ--; });
      render();
    }
    function makeContainerFromSelection() {
      if (!state.selectedIds.length) return;
      commitHistory();
      const nodes = state.selectedIds.map(getNode).filter(Boolean);
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      nodes.forEach(n => { const b = boundsOfNode(n); left = Math.min(left, b.left); top = Math.min(top, b.top); right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom); });
      const pad = 40;
      const container = {
        id: uid('n'),
        x: maybeSnap((left + right) / 2),
        y: maybeSnap((top + bottom) / 2),
        w: maybeSnap((right - left) + pad * 2),
        h: maybeSnap((bottom - top) + pad * 2),
        label: 'Container',
        type: 'container',
        z: Math.min(...nodes.map(n => n.z || 0)) - 1,
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
      floatingEditor.style.left = Math.min(rect.width - 340, clientX - rect.left + 10) + 'px';
      floatingEditor.style.top = Math.min(rect.height - 180, clientY - rect.top + 10) + 'px';
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

    function serialize() {
      return { version: 3, nodes: state.nodes, edges: state.edges, layers: state.layers, activeLayerId: state.activeLayerId, groups: state.groups, idSeq: state.idSeq, view: state.view };
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
      const nodeMap = new Map(state.nodes.map(node => [node.id, node]));
      const childMap = new Map(state.nodes.map(node => [node.id, []]));
      const incoming = new Map(state.nodes.map(node => [node.id, 0]));
      state.edges.forEach((edge) => {
        if (!childMap.has(edge.from) || !nodeMap.has(edge.to)) return;
        childMap.get(edge.from).push(edge.to);
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
      });
      const roots = sortNodesForTree(
        state.nodes.filter(node => (incoming.get(node.id) || 0) === 0).map(node => node.id),
        nodeMap
      );
      const lines = [];
      const visited = new Set();
      const walk = (id, depth) => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = nodeMap.get(id);
        if (!node) return;
        lines.push(`${'\t'.repeat(depth)}${String(node.label || '').replace(/\n/g, '\\n')}`);
        sortNodesForTree(childMap.get(id) || [], nodeMap).forEach(childId => walk(childId, depth + 1));
      };
      roots.forEach(rootId => walk(rootId, 0));
      sortNodesForTree(state.nodes.map(node => node.id).filter(id => !visited.has(id)), nodeMap).forEach(id => walk(id, 0));
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
        .filter(item => item.label.trim().length);
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
      const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
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
      const incoming = new Map(importedKeys.map(key => [key, 0]));
      const children = new Map(importedKeys.map(key => [key, []]));
      edges.forEach(({ from, to }) => {
        incoming.set(to, (incoming.get(to) || 0) + 1);
        children.get(from)?.push(to);
      });
      const roots = importedKeys.filter(key => (incoming.get(key) || 0) === 0);
      const orderedRoots = roots.length ? roots : [importedKeys[0]];
      const levelMap = new Map();
      const queue = orderedRoots.map(key => ({ key, level: 0 }));
      while (queue.length) {
        const { key, level } = queue.shift();
        if (levelMap.has(key)) continue;
        levelMap.set(key, level);
        (children.get(key) || []).forEach(child => queue.push({ key: child, level: level + 1 }));
      }
      importedKeys.forEach(key => { if (!levelMap.has(key)) levelMap.set(key, 0); });
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
      try { loadData(JSON.parse(raw)); setStatus('ブラウザ保存を読み込みました'); } catch { setStatus('保存データの読み込みに失敗しました', true); }
    }
    function saveAutosnapshot() { try { localStorage.setItem('diagram_editor_autosave_v3', JSON.stringify(serialize())); } catch {} }
    function loadAutosnapshot() {
      const raw = localStorage.getItem('diagram_editor_autosave_v3') || localStorage.getItem('diagram_editor_autosave_v2') || localStorage.getItem('diagram_editor_autosave_v1');
      if (!raw) return false;
      try { loadData(JSON.parse(raw)); setStatus('前回の自動保存を復元しました'); return true; } catch { return false; }
    }
    function exportSvg() {
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', svg.clientWidth);
      clone.setAttribute('height', svg.clientHeight);
      clone.querySelector('#tempLayer')?.replaceChildren();
      clone.querySelector('#selectionLayer')?.replaceChildren();
      const bg = createSvg('rect');
      bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#0b1020');
      clone.insertBefore(bg, clone.firstChild);
      const xml = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'diagram.svg';
      a.click();
      setStatus('SVGを書き出しました');
    }
    function exportPng() {
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', svg.clientWidth);
      clone.setAttribute('height', svg.clientHeight);
      clone.querySelector('#tempLayer')?.replaceChildren();
      clone.querySelector('#selectionLayer')?.replaceChildren();
      const bg = createSvg('rect');
      bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#0b1020');
      clone.insertBefore(bg, clone.firstChild);
      const xml = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = svg.clientWidth * 2;
        canvas.height = svg.clientHeight * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(pngBlob);
          a.download = 'diagram.png';
          a.click();
        });
      };
      img.src = url;
      setStatus('PNGを書き出しました');
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

    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      const world = screenToWorld(e.clientX, e.clientY);
      const node = getHitNode(e.target);
      const edge = getHitEdge(e.target);
      const edgeHandle = getEdgeHandleTarget(e.target);
      const resizeId = getResizeTarget(e.target);
      const wantPan = state.mode === 'pan' || e.ctrlKey;
      state.pointerDownInfo = {
        nodeId: node?.id || null,
        clientX: e.clientX,
        clientY: e.clientY,
        moved: false,
      };

      if (edgeHandle && !wantPan) {
        commitHistory();
        state.draggingEdgeHandle = edgeHandle;
        return;
      }
      if (resizeId) {
        commitHistory();
        state.resizingNodeId = resizeId;
        const n = getNode(resizeId);
        state.resizingStart = { startX: world.x, startY: world.y, w: n.w, h: n.h };
        return;
      }
      if (node && !wantPan) {
        if (getLayer(node.layerId)?.locked) return;
        if (state.mode === 'connect') {
          if (!state.connectFrom) {
            if (!isSelected(node.id)) setPrimarySelection(node.id, false);
            state.connectFrom = node.id;
            setStatus('接続先のノードをクリックしてください');
          } else {
            commitHistory();
            connectNodes(state.connectFrom, node.id);
            state.connectFrom = null;
            setStatus('接続しました');
          }
          return;
        }
        if (state.mode === 'add') {
          commitHistory();
          const newNode = addNodeAt(world.x + 180, world.y, state.shapeToAdd);
          state.edges.push(createEdge(node.id, newNode.id));
          render();
          setMode('select');
          return;
        }
        if (e.shiftKey) toggleSelection(node.id); else if (!isSelected(node.id)) setPrimarySelection(node.id, false);
        state.draggingNodeIds = [...state.selectedIds];
        state.dragStartWorld = world;
        state.dragOrigins = new Map(state.draggingNodeIds.map(id => [id, { x: getNode(id).x, y: getNode(id).y }]));
        return;
      }
      if (edge && !wantPan) {
        state.selectedEdgeId = edge.id;
        state.selectedIds = [];
        state.primarySelectedId = null;
        render();
        return;
      }
      if (state.mode === 'add') {
        commitHistory();
        addNodeAt(world.x, world.y, state.shapeToAdd);
        return;
      }
      if (!wantPan) {
        state.selectionRect = { x1: world.x, y1: world.y, x2: world.x, y2: world.y };
        if (!e.shiftKey) { clearSelection(); render(); }
        return;
      }
      state.draggingCanvas = true;
      state.panStart = { x: e.clientX, y: e.clientY, viewX: state.view.x, viewY: state.view.y };
      svg.classList.add('dragging-canvas');
    });

    svg.addEventListener('pointermove', (e) => {
      const world = screenToWorld(e.clientX, e.clientY);
      state.tempMouse = world;
      state.guides = [];
      if (state.pointerDownInfo) {
        const dx = e.clientX - state.pointerDownInfo.clientX;
        const dy = e.clientY - state.pointerDownInfo.clientY;
        if ((dx * dx + dy * dy) > 16) state.pointerDownInfo.moved = true;
      }
      if (state.resizingNodeId) {
        const n = getNode(state.resizingNodeId);
        if (!n) return;
        const dx = world.x - state.resizingStart.startX;
        const dy = world.y - state.resizingStart.startY;
        n.w = clamp(maybeSnap(state.resizingStart.w + dx), 60, 700);
        n.h = clamp(maybeSnap(state.resizingStart.h + dy), 36, 500);
        render();
        return;
      }
      if (state.draggingEdgeHandle) {
        const edgeToUpdate = getEdge(state.draggingEdgeHandle.edgeId);
        if (!edgeToUpdate) return;
        if (retargetEdgeHandle(edgeToUpdate, state.draggingEdgeHandle.end, world)) {
          render();
        }
        return;
      }
      if (state.draggingNodeIds) {
        const dx = world.x - state.dragStartWorld.x;
        const dy = world.y - state.dragStartWorld.y;
        const primaryId = state.primarySelectedId || state.draggingNodeIds[0];
        const origin = state.dragOrigins.get(primaryId);
        let nextPrimaryX = maybeSnap(origin.x + dx);
        let nextPrimaryY = maybeSnap(origin.y + dy);
        const guided = calculateGuidedPosition(primaryId, nextPrimaryX, nextPrimaryY);
        nextPrimaryX = guided.x; nextPrimaryY = guided.y;
        const diffX = nextPrimaryX - origin.x;
        const diffY = nextPrimaryY - origin.y;
        state.draggingNodeIds.forEach(id => {
          const n = getNode(id), o = state.dragOrigins.get(id);
          if (!n || !o) return;
          n.x = maybeSnap(o.x + diffX);
          n.y = maybeSnap(o.y + diffY);
        });
        moveGroupMembers(state.draggingNodeIds, diffX, diffY);
        render();
        return;
      }
      if (state.draggingCanvas) {
        const dx = (e.clientX - state.panStart.x) / state.view.scale;
        const dy = (e.clientY - state.panStart.y) / state.view.scale;
        state.view.x = state.panStart.viewX - dx;
        state.view.y = state.panStart.viewY - dy;
        render();
        return;
      }
      if (state.selectionRect) {
        state.selectionRect.x2 = world.x;
        state.selectionRect.y2 = world.y;
        drawSelectionRect();
        return;
      }
      if (state.mode === 'connect' && state.connectFrom) drawTemp();
    });

    svg.addEventListener('pointerup', (e) => {
      const clickedNode = state.pointerDownInfo?.nodeId ? getNode(state.pointerDownInfo.nodeId) : null;
      const clickInfo = state.pointerDownInfo;
      state.draggingNodeIds = null;
      state.draggingEdgeHandle = null;
      state.resizingNodeId = null;
      state.resizingStart = null;
      if (state.draggingCanvas) {
        state.draggingCanvas = false;
        svg.classList.remove('dragging-canvas');
      }
      if (state.selectionRect) {
        const left = Math.min(state.selectionRect.x1, state.selectionRect.x2);
        const right = Math.max(state.selectionRect.x1, state.selectionRect.x2);
        const top = Math.min(state.selectionRect.y1, state.selectionRect.y2);
        const bottom = Math.max(state.selectionRect.y1, state.selectionRect.y2);
        const picked = state.nodes.filter(n => {
          const b = boundsOfNode(n);
          return b.left >= left && b.right <= right && b.top >= top && b.bottom <= bottom && getLayer(n.layerId)?.visible !== false;
        }).map(n => n.id);
        state.selectedIds = [...new Set([...state.selectedIds, ...picked])];
        state.primarySelectedId = state.selectedIds[0] || null;
        state.selectionRect = null;
        render();
      }
      if (clickInfo?.nodeId && clickedNode && !clickInfo.moved) {
        const now = Date.now();
        if (state.lastNodeClick && state.lastNodeClick.nodeId === clickedNode.id && (now - state.lastNodeClick.at) < 350) {
          openFloatingEditor(clickedNode, e.clientX, e.clientY);
          state.lastNodeClick = null;
        } else {
          state.lastNodeClick = { nodeId: clickedNode.id, at: now };
        }
      } else if (clickInfo && !clickInfo.moved) {
        state.lastNodeClick = null;
      }
      state.pointerDownInfo = null;
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const before = screenToWorld(e.clientX, e.clientY);
      state.view.scale = clamp(state.view.scale * (e.deltaY < 0 ? 1.1 : 0.9), 0.2, 3);
      state.view.x = before.x - mouseX / state.view.scale;
      state.view.y = before.y - mouseY / state.view.scale;
      render();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      const inInput = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); downloadJson(); return; }
      if (e.key === 'Delete' && !inInput) { removeSelection(); return; }
      if (e.key === 'Escape') { state.connectFrom = null; closeFloatingEditor(); render(); return; }
      if (e.key === 'Tab' && !inInput) { e.preventDefault(); addChildNode(); return; }
      if (e.key === 'Enter' && !inInput) { e.preventDefault(); addSiblingBelowNode(); return; }
    });

    modeChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      setMode(chip.dataset.mode);
    });
    shapeLibrary.addEventListener('click', (e) => {
      const card = e.target.closest('.shape-card');
      if (!card) return;
      setShapeToAdd(card.dataset.shape);
    });
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[data-trigger]');
      if (!item) return;
      const target = document.getElementById(item.dataset.trigger);
      if (!target) return;
      target.click();
    });
    connectorTypeEl.addEventListener('change', () => {
      if (!state.selectedEdgeId) return;
      const edge = getEdge(state.selectedEdgeId);
      if (!edge) return;
      commitHistory();
      edge.connector = connectorTypeEl.value;
      render();
    });

    document.getElementById('btnAddCenter').addEventListener('click', () => {
      commitHistory();
      const b = visibleWorldBounds();
      addNodeAt((b.left + b.right) / 2, (b.top + b.bottom) / 2, state.shapeToAdd);
    });
    document.getElementById('btnAutoLayout').addEventListener('click', () => {
      if (!state.nodes.length) return;
      commitHistory();
      const center = getPrimaryNode() || state.nodes[0];
      const neighbors = [...new Set(state.edges.filter(e => e.from === center.id).map(e => e.to).concat(state.edges.filter(e => e.to === center.id).map(e => e.from)))].map(getNode).filter(Boolean);
      if (!neighbors.length) return setStatus('中心ノードに接続されたノードがありません', true);
      const radiusX = 260, radiusY = Math.max(140, neighbors.length * 26);
      neighbors.forEach((node, i) => {
        const angle = (-Math.PI / 2) + (i / Math.max(1, neighbors.length)) * Math.PI * 2;
        node.x = maybeSnap(center.x + Math.cos(angle) * radiusX);
        node.y = maybeSnap(center.y + Math.sin(angle) * radiusY);
      });
      render();
    });
    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnRedo').addEventListener('click', redo);
    document.getElementById('btnDuplicate').addEventListener('click', duplicateSelection);
    document.getElementById('btnDelete').addEventListener('click', removeSelection);
    document.getElementById('btnAlignLeft').addEventListener('click', () => applyAlignment('left'));
    document.getElementById('btnAlignCenter').addEventListener('click', () => applyAlignment('center'));
    document.getElementById('btnAlignRight').addEventListener('click', () => applyAlignment('right'));
    document.getElementById('btnAlignTop').addEventListener('click', () => applyAlignment('top'));
    document.getElementById('btnAlignMiddle').addEventListener('click', () => applyAlignment('middle'));
    document.getElementById('btnAlignBottom').addEventListener('click', () => applyAlignment('bottom'));
    document.getElementById('btnDistributeH').addEventListener('click', () => distribute('h'));
    document.getElementById('btnDistributeV').addEventListener('click', () => distribute('v'));
    document.getElementById('btnSameSize').addEventListener('click', sameSize);
    document.getElementById('btnGroup').addEventListener('click', groupSelection);
    document.getElementById('btnUngroup').addEventListener('click', ungroupSelection);
    document.getElementById('btnBringFront').addEventListener('click', bringFront);
    document.getElementById('btnSendBack').addEventListener('click', sendBack);
    document.getElementById('btnApply').addEventListener('click', () => applyInspectorChanges(true));
    [selectedLabel, selectedW, selectedH, selectedFill, selectedStroke, selectedTextColor].forEach((el) => {
      el.addEventListener('focus', beginInspectorEdit);
      el.addEventListener('blur', endInspectorEdit);
      el.addEventListener('input', () => applyInspectorChanges(!state.inspectorEditing));
    });
    [selectedType, selectedLayer, selectedNoStroke].forEach((el) => {
      el.addEventListener('focus', beginInspectorEdit);
      el.addEventListener('blur', endInspectorEdit);
      el.addEventListener('change', () => applyInspectorChanges(!state.inspectorEditing));
    });
    document.getElementById('btnMakeContainer').addEventListener('click', makeContainerFromSelection);
    document.getElementById('btnAddLayer').addEventListener('click', addLayer);
    document.getElementById('btnRenameLayer').addEventListener('click', renameLayer);
    document.getElementById('btnSaveJson').addEventListener('click', downloadJson);
    document.getElementById('btnLoadJson').addEventListener('click', () => {
      fileInput.dataset.format = 'json';
      fileInput.click();
    });
    document.getElementById('btnSaveMermaid').addEventListener('click', downloadMermaid);
    document.getElementById('btnLoadMermaid').addEventListener('click', () => {
      fileInput.dataset.format = 'mermaid';
      fileInput.click();
    });
    document.getElementById('btnSaveText').addEventListener('click', downloadIndentedText);
    document.getElementById('btnLoadText').addEventListener('click', () => {
      fileInput.dataset.format = 'text';
      fileInput.click();
    });
    document.getElementById('btnExportPng').addEventListener('click', exportPng);
    document.getElementById('btnExportSvg').addEventListener('click', exportSvg);
    document.getElementById('btnSaveLocal').addEventListener('click', saveLocal);
    document.getElementById('btnLoadLocal').addEventListener('click', loadLocal);
    document.getElementById('btnNew').addEventListener('click', () => {
      if (!confirm('新規作成します。現在の内容は初期状態に戻ります。')) return;
      commitHistory();
      state.nodes = []; state.edges = []; state.groups = []; state.selectedIds = []; state.primarySelectedId = null; state.selectedEdgeId = null; state.idSeq = 1;
      createInitial();
    });
    document.getElementById('zoomIn').addEventListener('click', () => { state.view.scale = clamp(state.view.scale * 1.15, 0.2, 3); render(); });
    document.getElementById('zoomOut').addEventListener('click', () => { state.view.scale = clamp(state.view.scale / 1.15, 0.2, 3); render(); });
    document.getElementById('zoomReset').addEventListener('click', () => { state.view.scale = 1; render(); });
    document.getElementById('btnLeftMenu').addEventListener('click', () => leftbar.classList.toggle('open'));
    document.getElementById('btnRightMenu').addEventListener('click', () => rightbar.classList.toggle('open'));

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const selectedFormat = fileInput.dataset.format || '';
      const name = file.name.toLowerCase();
      try {
        if (selectedFormat === 'mermaid' || name.endsWith('.mmd') || name.endsWith('.mermaid')) {
          importMermaid(text);
          setStatus('Mermaidを読み込みました');
        } else if (selectedFormat === 'text' || name.endsWith('.txt')) {
          importIndentedText(text);
          setStatus('テキストを読み込みました');
        } else {
          loadData(JSON.parse(text));
          setStatus('JSONを読み込みました');
        }
      }
      catch {
        alert(
          selectedFormat === 'mermaid' || name.endsWith('.mmd') || name.endsWith('.mermaid')
            ? 'Mermaidの読み込みに失敗しました'
            : selectedFormat === 'text' || name.endsWith('.txt')
              ? 'テキストの読み込みに失敗しました'
              : 'JSONの読み込みに失敗しました'
        );
      }
      finally { fileInput.value = ''; fileInput.dataset.format = ''; }
    });
    document.getElementById('floatingOk').addEventListener('click', () => {
      const node = getNode(state.editingNodeId);
      if (!node) return;
      commitHistory();
      node.label = floatingText.value.trim() || node.label;
      closeFloatingEditor();
      render();
    });
    floatingText.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      document.getElementById('floatingOk').click();
    });
    document.getElementById('floatingCancel').addEventListener('click', closeFloatingEditor);
    document.getElementById('minimap').addEventListener('click', (e) => {
      const nodes = sortedVisibleNodes();
      if (!nodes.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => { minX = Math.min(minX, n.x - n.w / 2); minY = Math.min(minY, n.y - n.h / 2); maxX = Math.max(maxX, n.x + n.w / 2); maxY = Math.max(maxY, n.y + n.h / 2); });
      const pad = 80; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const scale = Math.min(210 / (maxX - minX), 140 / (maxY - minY));
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const wx = minX + mx / scale, wy = minY + my / scale;
      const b = visibleWorldBounds();
      state.view.x = wx - (b.right - b.left) / 2;
      state.view.y = wy - (b.bottom - b.top) / 2;
      render();
    });

    window.addEventListener('resize', render);

    if (!loadAutosnapshot()) createInitial(); else render();
