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
    if (e.shiftKey) toggleSelection(node.id);
    else if (!isSelected(node.id)) setPrimarySelection(node.id, false);
    const rootIds = e.shiftKey ? [...state.selectedIds] : [node.id];
    const dragContext = buildDragContext(rootIds);
    state.dragRootIds = dragContext.rootIds;
    state.draggingNodeIds = dragContext.draggingNodeIds;
    state.dragStartWorld = world;
    state.dragOrigins = dragContext.dragOrigins;
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
    if (!e.shiftKey) {
      clearSelection();
      render();
    }
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
    nextPrimaryX = guided.x;
    nextPrimaryY = guided.y;
    const diffX = nextPrimaryX - origin.x;
    const diffY = nextPrimaryY - origin.y;
    state.draggingNodeIds.forEach((id) => {
      const n = getNode(id);
      const o = state.dragOrigins.get(id);
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
  state.dragRootIds = null;
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
    const picked = state.nodes.filter((n) => {
      const b = boundsOfNode(n);
      return b.left >= left && b.right <= right && b.top >= top && b.bottom <= bottom && getLayer(n.layerId)?.visible !== false;
    }).map((n) => n.id);
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
  state.nodes = [];
  state.edges = [];
  state.groups = [];
  state.selectedIds = [];
  state.primarySelectedId = null;
  state.selectedEdgeId = null;
  state.idSeq = 1;
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
  } catch {
    alert(
      selectedFormat === 'mermaid' || name.endsWith('.mmd') || name.endsWith('.mermaid')
        ? 'Mermaidの読み込みに失敗しました'
        : selectedFormat === 'text' || name.endsWith('.txt')
          ? 'テキストの読み込みに失敗しました'
          : 'JSONの読み込みに失敗しました',
    );
  } finally {
    fileInput.value = '';
    fileInput.dataset.format = '';
  }
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
  const scale = Math.min(210 / (maxX - minX), 140 / (maxY - minY));
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const wx = minX + mx / scale;
  const wy = minY + my / scale;
  const b = visibleWorldBounds();
  state.view.x = wx - (b.right - b.left) / 2;
  state.view.y = wy - (b.bottom - b.top) / 2;
  render();
});

window.addEventListener('resize', render);

if (!loadAutosnapshot()) createInitial();
else render();
