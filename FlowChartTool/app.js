const APP_VERSION = "1.0.0";
const canvas = document.getElementById("canvas");
    const canvasArea = document.getElementById("canvasArea");
    const modeLabel = document.getElementById("modeLabel");
    const stats = document.getElementById("stats");
    const appVersion = document.getElementById("appVersion");
    const inspectorEmpty = document.getElementById("inspectorEmpty");
    const inspectorFields = document.getElementById("inspectorFields");
    const inspectorLink = document.getElementById("inspectorLink");
    const labelInput = document.getElementById("labelInput");
    const widthInput = document.getElementById("widthInput");
    const heightInput = document.getElementById("heightInput");
    const colorInput = document.getElementById("colorInput");
    const colorPicker = document.getElementById("colorPicker");
    const fontSizeInput = document.getElementById("fontSizeInput");
    const fromSideSelect = document.getElementById("fromSideSelect");
    const toSideSelect = document.getElementById("toSideSelect");
    const linkArrowSelect = document.getElementById("linkArrowSelect");
    const linkStyleSelect = document.getElementById("linkStyleSelect");
    const defaultLinkStyle = document.getElementById("defaultLinkStyle");
    const zoomInButton = document.getElementById("zoomIn");
    const zoomOutButton = document.getElementById("zoomOut");
    const zoomResetButton = document.getElementById("zoomReset");
    const toggleSnapButton = document.getElementById("toggleSnap");
    const snapSizeInput = document.getElementById("snapSizeInput");
    const copySelectionButton = document.getElementById("copySelection");
    const exportPngButton = document.getElementById("exportPng");
    const toggleMindmapButton = document.getElementById("toggleMindmap");
    const toggleSidebarButton = document.getElementById("toggleSidebar");
    const groupNodesButton = document.getElementById("groupNodes");
    const ungroupNodesButton = document.getElementById("ungroupNodes");
    const alignLeftButton = document.getElementById("alignLeft");
    const alignCenterButton = document.getElementById("alignCenter");
    const alignRightButton = document.getElementById("alignRight");
    const alignTopButton = document.getElementById("alignTop");
    const alignMiddleButton = document.getElementById("alignMiddle");
    const alignBottomButton = document.getElementById("alignBottom");
    const sendToBackButton = document.getElementById("sendToBack");
    const undoLimitInput = document.getElementById("undoLimitInput");

    const state = {
      nodes: [],
      links: [],
      mode: "move",
      selectedId: null,
      selectedIds: [],
      selectedLinkId: null,
      arrowEnabled: false,
      connectFrom: null,
      dragging: null,
      dragGroup: null,
      resizing: null,
      panning: false,
      boxSelecting: false,
      interactionMode: "pan",
      selectAdditive: false,
      suppressClick: false,
      clipboard: null,
      snapEnabled: true,
      snapSize: 10,
      mindmapMode: true,
      copyOnDrag: false,
      copyOrigin: { x: 0, y: 0 },
      copySourceIds: [],
      dragOffset: { x: 0, y: 0 },
      tempLine: null,
      editingId: null,
      panStart: { x: 0, y: 0, viewX: 0, viewY: 0 },
      selectStart: { x: 0, y: 0 },
    };

    const history = {
      stack: [],
      index: -1,
      timer: null,
      limit: 50,
    };

    const shapes = {
      start: { w: 130, h: 70, label: "Start", type: "start" },
      process: { w: 150, h: 80, label: "Process", type: "process" },
      decision: { w: 160, h: 90, label: "Decision", type: "decision" },
      io: { w: 150, h: 70, label: "Input/Output", type: "io" },
      dashed: { w: 150, h: 80, label: "Dashed", type: "dashed" },
      text: { w: 180, h: 50, label: "Text", type: "text" },
    };

    function createNode(type) {
      const base = shapes[type];
      const id = crypto.randomUUID();
      const node = {
        id,
        type,
        x: 200 + state.nodes.length * 30,
        y: 140 + state.nodes.length * 20,
        w: base.w,
        h: base.h,
        label: type === "dashed" ? "" : base.label,
        color: type === "text" || type === "dashed" ? "transparent" : "#ffffff",
        fontSize: 14,
      };
      state.nodes.push(node);
      render();
      selectNode(id);
      pushHistory();
      return node;
    }

    function duplicateNode(baseNode, dx, dy, connectFromId = null) {
      const node = {
        ...baseNode,
        id: crypto.randomUUID(),
        x: baseNode.x + dx,
        y: baseNode.y + dy,
      };
      if (connectFromId) {
        node.mindmapRootId = connectFromId;
      }
      state.nodes.push(node);
      if (connectFromId) {
        state.links.push({
          id: crypto.randomUUID(),
          from: connectFromId,
          to: node.id,
          arrow: false,
          fromSide: "right",
          toSide: "left",
          style: defaultLinkStyle ? defaultLinkStyle.value : "curve",
        });
      }
      render();
      selectNode(node.id);
      pushHistory();
    }

    const inlineEditor = document.createElement("textarea");
    inlineEditor.className = "inline-editor";
    inlineEditor.hidden = true;
    canvasArea.appendChild(inlineEditor);

    const selectionRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    selectionRect.classList.add("selection-rect");
    selectionRect.setAttribute("visibility", "hidden");
    canvas.appendChild(selectionRect);

    function cloneSnapshot() {
      const viewBox = canvas.viewBox.baseVal;
      return {
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        links: JSON.parse(JSON.stringify(state.links)),
        viewBox: {
          x: viewBox.x,
          y: viewBox.y,
          width: viewBox.width,
          height: viewBox.height,
        },
      };
    }

    function pushHistory() {
      const snapshot = cloneSnapshot();
      if (history.index < history.stack.length - 1) {
        history.stack = history.stack.slice(0, history.index + 1);
      }
      history.stack.push(snapshot);
      if (history.stack.length > history.limit) {
        const drop = history.stack.length - history.limit;
        history.stack = history.stack.slice(drop);
        history.index = Math.max(history.index - drop, 0);
      }
      history.index = history.stack.length - 1;
    }

    function scheduleHistory() {
      if (history.timer) clearTimeout(history.timer);
      history.timer = setTimeout(() => {
        history.timer = null;
        pushHistory();
      }, 250);
    }

    function applySnapshot(snapshot) {
      if (!snapshot) return;
      state.nodes = JSON.parse(JSON.stringify(snapshot.nodes));
      state.links = JSON.parse(JSON.stringify(snapshot.links));
      state.selectedId = null;
      state.selectedIds = [];
      state.selectedLinkId = null;
      const viewBox = canvas.viewBox.baseVal;
      viewBox.x = snapshot.viewBox.x;
      viewBox.y = snapshot.viewBox.y;
      viewBox.width = snapshot.viewBox.width;
      viewBox.height = snapshot.viewBox.height;
      updateInspector();
      render();
    }

    function setMode(mode) {
      state.mode = mode;
      state.connectFrom = null;
      clearTempLine();
      modeLabel.textContent = `MODE: ${mode.toUpperCase()}`;
      document.getElementById("toggleConnect").classList.toggle("secondary", mode === "connect");
      document.getElementById("toggleConnect").classList.toggle("ghost", mode !== "connect");
    }

    function updateArrowButton() {
      const btn = document.getElementById("toggleArrow");
      const selected = state.links.find(link => link.id === state.selectedLinkId);
      if (selected) {
        btn.textContent = `Arrow: ${state.arrowEnabled ? "ON" : "OFF"} | Selected: ${selected.arrow ? "ON" : "OFF"}`;
      } else {
        btn.textContent = `Arrow: ${state.arrowEnabled ? "ON" : "OFF"}`;
      }
    }

    function updatePanSelectButton() {
      const btn = document.getElementById("togglePanSelect");
      btn.textContent = state.interactionMode === "pan" ? "Pan" : "Select";
    }

    function updateSnapButton() {
      toggleSnapButton.textContent = `Snap: ${state.snapEnabled ? "ON" : "OFF"}`;
    }

    function updateMindmapButton() {
      toggleMindmapButton.textContent = `Mindmap: ${state.mindmapMode ? "ON" : "OFF"}`;
    }

    function updateSidebarButton() {
      const collapsed = document.body.classList.contains("sidebar-collapsed");
      toggleSidebarButton.textContent = collapsed ? "Show Shapes" : "Hide Shapes";
    }

    function render() {
      canvas.querySelectorAll(".node").forEach(node => node.remove());
      canvas.querySelectorAll(".connector").forEach(link => link.remove());

      state.links.forEach(link => drawLink(link));
      state.nodes.forEach(node => drawNode(node));
      stats.textContent = `Nodes ${state.nodes.length} | Links ${state.links.length}`;
      updateArrowButton();
      updatePanSelectButton();
      updateSnapButton();
      updateMindmapButton();
      updateSidebarButton();
      updateSelectionControls();
    }

    function drawNode(node) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("node");
      group.classList.add(node.type);
      if (state.selectedIds.includes(node.id)) {
        group.classList.add("selected");
      }
      group.dataset.id = node.id;
      group.setAttribute("transform", `translate(${node.x} ${node.y})`);

      let shapeElement;
      if (node.type === "text") {
        shapeElement = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        shapeElement.setAttribute("width", node.w);
        shapeElement.setAttribute("height", node.h);
        shapeElement.setAttribute("rx", 10);
      } else if (node.type === "start") {
        shapeElement = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        shapeElement.setAttribute("cx", node.w / 2);
        shapeElement.setAttribute("cy", node.h / 2);
        shapeElement.setAttribute("rx", node.w / 2);
        shapeElement.setAttribute("ry", node.h / 2);
      } else if (node.type === "decision") {
        shapeElement = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        const points = [
          [node.w / 2, 0],
          [node.w, node.h / 2],
          [node.w / 2, node.h],
          [0, node.h / 2],
        ].map(p => p.join(",")).join(" ");
        shapeElement.setAttribute("points", points);
      } else if (node.type === "io") {
        shapeElement = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        const skew = 18;
        const points = [
          [skew, 0],
          [node.w, 0],
          [node.w - skew, node.h],
          [0, node.h],
        ].map(p => p.join(",")).join(" ");
        shapeElement.setAttribute("points", points);
      } else {
        shapeElement = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        shapeElement.setAttribute("width", node.w);
        shapeElement.setAttribute("height", node.h);
        shapeElement.setAttribute("rx", 16);
      }

      if (shapeElement) {
        shapeElement.classList.add("node-shape");
        shapeElement.setAttribute("fill", node.color);
        if (node.type === "text") {
          shapeElement.setAttribute("stroke", "none");
        } else if (node.type === "dashed") {
          shapeElement.setAttribute("stroke", "#264653");
          shapeElement.setAttribute("stroke-width", "2");
          shapeElement.setAttribute("stroke-dasharray", "6 6");
        } else if (state.selectedIds.includes(node.id)) {
          shapeElement.setAttribute("stroke", "#e76f51");
          shapeElement.setAttribute("stroke-width", "3");
        } else {
          shapeElement.setAttribute("stroke", "#264653");
          shapeElement.setAttribute("stroke-width", "2");
        }
        group.appendChild(shapeElement);
      }

      if (node.label) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const fontSize = node.fontSize || 14;
        const lines = String(node.label).split("\n");
        const lineHeight = fontSize * 1.2;
        const startY = node.h / 2 - (lines.length - 1) * lineHeight / 2 + 4;
        text.setAttribute("x", node.w / 2);
        text.setAttribute("y", startY);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", fontSize);
        lines.forEach((line, index) => {
          const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspan.setAttribute("x", node.w / 2);
          if (index > 0) {
            tspan.setAttribute("dy", lineHeight);
          }
          tspan.textContent = line;
          text.appendChild(tspan);
        });
        group.appendChild(text);
      }

      group.addEventListener("mousedown", startDrag);
      group.addEventListener("click", handleNodeClick);
      group.addEventListener("dblclick", event => {
        event.stopPropagation();
        startInlineEdit(node);
      });

      if (state.selectedIds.length === 1 && state.selectedIds[0] === node.id) {
        addResizeHandles(group, node);
      }
      canvas.appendChild(group);
    }

    function drawLink(link) {
      const from = state.nodes.find(n => n.id === link.from);
      const to = state.nodes.find(n => n.id === link.to);
      if (!from || !to) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("connector");
      if (state.selectedLinkId === link.id) {
        path.classList.add("selected");
      }
      path.dataset.id = link.id;
      const start = link.fromSide
        ? getSideCenter(from, link.fromSide)
        : getEdgeCenter(from, to);
      const end = link.toSide
        ? getSideCenter(to, link.toSide)
        : getEdgeCenter(to, from);
      const d = buildLinkPath(start, end, link.style || "curve");
      path.setAttribute("d", d);
      path.setAttribute("stroke", "#2a9d8f");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("fill", "none");
      path.setAttribute("marker-end", link.arrow === false ? "none" : "url(#arrow)");
      path.addEventListener("click", event => {
        event.stopPropagation();
        selectLink(link.id);
      });
      canvas.appendChild(path);
    }

    function handleNodeClick(event) {
      event.stopPropagation();
      const id = event.currentTarget.dataset.id;
      const node = state.nodes.find(n => n.id === id);
      if (!node) return;
      if (state.mode === "connect") {
        if (node.type === "text") return;
        if (!state.connectFrom) {
          const fromId = state.selectedId && state.selectedId !== id ? state.selectedId : id;
          if (fromId !== id) {
            state.links.push({
              id: crypto.randomUUID(),
              from: fromId,
              to: id,
              arrow: state.arrowEnabled,
              fromSide: "right",
              toSide: "left",
              style: defaultLinkStyle ? defaultLinkStyle.value : "curve",
            });
            render();
            pushHistory();
            return;
          }
          state.connectFrom = id;
          highlightTempLine(id);
        } else if (state.connectFrom !== id) {
          state.links.push({
            id: crypto.randomUUID(),
            from: state.connectFrom,
            to: id,
            arrow: state.arrowEnabled,
            fromSide: "right",
            toSide: "left",
            style: defaultLinkStyle ? defaultLinkStyle.value : "curve",
          });
          state.connectFrom = null;
          clearTempLine();
          render();
          pushHistory();
        }
      } else {
        selectNode(id, { toggle: event.ctrlKey || event.metaKey });
      }
    }

    function highlightTempLine(fromId) {
      clearTempLine();
      const from = state.nodes.find(n => n.id === fromId);
      if (!from) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("connector", "temp");
      const start = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
      const end = { x: start.x + 120, y: start.y };
      const anchor = getEdgeCenter(from, end);
      line.setAttribute("d", `M ${anchor.x} ${anchor.y} L ${end.x} ${end.y}`);
      state.tempLine = line;
      canvas.appendChild(line);
    }

    function clearTempLine() {
      if (state.tempLine) {
        state.tempLine.remove();
        state.tempLine = null;
      }
    }

    function selectNode(id, options = {}) {
      if (state.editingId && state.editingId !== id) {
        commitInlineEdit();
      }
      if (!id) {
        state.selectedIds = [];
        state.selectedId = null;
      } else if (options.toggle) {
        const groupId = getGroupId(id);
        const ids = groupId ? state.nodes.filter(n => n.groupId === groupId).map(n => n.id) : [id];
        const allSelected = ids.every(item => state.selectedIds.includes(item));
        if (allSelected) {
          state.selectedIds = state.selectedIds.filter(item => !ids.includes(item));
        } else {
          const merged = new Set([...state.selectedIds, ...ids]);
          state.selectedIds = Array.from(merged);
        }
        state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null;
      } else {
        const groupId = getGroupId(id);
        state.selectedIds = groupId
          ? state.nodes.filter(n => n.groupId === groupId).map(n => n.id)
          : [id];
        state.selectedId = id;
      }
      state.selectedLinkId = null;
      updateInspector();
      render();
    }

    function selectLink(id) {
      if (state.editingId) {
        commitInlineEdit();
      }
      state.selectedLinkId = id;
      state.selectedId = null;
      state.selectedIds = [];
      updateInspector();
      render();
    }

    function updateInspector() {
      const selectedLink = state.links.find(link => link.id === state.selectedLinkId);
      if (selectedLink) {
        inspectorEmpty.hidden = true;
        inspectorFields.hidden = true;
        inspectorLink.hidden = false;
        linkArrowSelect.value = selectedLink.arrow === false ? "off" : "on";
        linkStyleSelect.value = selectedLink.style || "curve";
        fromSideSelect.value = selectedLink.fromSide || "right";
        toSideSelect.value = selectedLink.toSide || "left";
        return;
      }
      const node = state.nodes.find(n => n.id === state.selectedId);
      if (!node) {
        inspectorEmpty.hidden = false;
        inspectorFields.hidden = true;
        inspectorLink.hidden = true;
        inspectorFields.dataset.id = "";
        return;
      }
      inspectorEmpty.hidden = true;
      inspectorFields.hidden = false;
      inspectorLink.hidden = true;
      inspectorFields.dataset.id = node.id;
      labelInput.value = node.label;
      widthInput.value = node.w;
      heightInput.value = node.h;
      colorInput.value = node.color;
      colorPicker.value = normalizeHexColor(node.color, "#ffffff");
      fontSizeInput.value = node.fontSize || 14;

      const isMulti = state.selectedIds.length > 1;
      labelInput.disabled = isMulti;
      fontSizeInput.disabled = isMulti;
    }

    function updateSelectionControls() {
      const selectedCount = state.selectedIds.length ? state.selectedIds.length : (state.selectedId ? 1 : 0);
      const hasGroup = state.selectedIds.some(id => {
        const node = state.nodes.find(n => n.id === id);
        return node && node.groupId;
      });
      groupNodesButton.disabled = selectedCount < 2;
      ungroupNodesButton.disabled = !hasGroup;
      const alignDisabled = selectedCount < 2;
      alignLeftButton.disabled = alignDisabled;
      alignCenterButton.disabled = alignDisabled;
      alignRightButton.disabled = alignDisabled;
      alignTopButton.disabled = alignDisabled;
      alignMiddleButton.disabled = alignDisabled;
      alignBottomButton.disabled = alignDisabled;
      sendToBackButton.disabled = selectedCount < 1;
    }

    function getSvgPoint(event) {
      const ctm = canvas.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const point = typeof DOMPoint === "function"
        ? new DOMPoint(event.clientX, event.clientY)
        : canvas.createSVGPoint();
      if (!("matrixTransform" in point)) {
        point.x = event.clientX;
        point.y = event.clientY;
      }
      const transformed = point.matrixTransform(ctm.inverse());
      return { x: transformed.x, y: transformed.y };
    }

    function zoomCanvas(factor) {
      const viewBox = canvas.viewBox.baseVal;
      const centerX = viewBox.x + viewBox.width / 2;
      const centerY = viewBox.y + viewBox.height / 2;
      const newWidth = viewBox.width * factor;
      const newHeight = viewBox.height * factor;
      viewBox.x = centerX - newWidth / 2;
      viewBox.y = centerY - newHeight / 2;
      viewBox.width = newWidth;
      viewBox.height = newHeight;
      pushHistory();
    }

    function resetZoom() {
      canvas.setAttribute("viewBox", "0 0 1200 900");
      pushHistory();
    }

    function exportPng() {
      const serializer = new XMLSerializer();
      const viewBox = canvas.viewBox.baseVal;
      const svgClone = canvas.cloneNode(true);
      svgClone.querySelectorAll(".selection-rect").forEach(node => node.remove());
      svgClone.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
      svgClone.setAttribute("width", viewBox.width);
      svgClone.setAttribute("height", viewBox.height);
      svgClone.removeAttribute("preserveAspectRatio");
      const svgString = serializer.serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = viewBox.width * scale;
        exportCanvas.height = viewBox.height * scale;
        const ctx = exportCanvas.getContext("2d");
        ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(img, 0, 0, exportCanvas.width, exportCanvas.height);
        URL.revokeObjectURL(url);
        exportCanvas.toBlob(blob => {
          if (!blob) return;
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          const now = new Date();
          const stamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
          ].join("") + "_" + [
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
            String(now.getSeconds()).padStart(2, "0"),
          ].join("");
          link.download = `flowchart_${stamp}.png`;
          link.click();
        }, "image/png");
      };
      img.src = url;
    }

    function isNodeTarget(target) {
      if (!target) return false;
      if (typeof target.closest === "function") {
        return Boolean(target.closest(".node"));
      }
      let el = target;
      while (el) {
        if (el.classList && el.classList.contains("node")) return true;
        el = el.parentNode;
      }
      return false;
    }

    function findNodeFromEvent(event) {
      let el = event.target;
      if (el && typeof el.closest === "function") {
        el = el.closest(".node");
      } else {
        while (el && !(el.classList && el.classList.contains("node"))) {
          el = el.parentNode;
        }
      }
      if (!el || !el.dataset || !el.dataset.id) return null;
      return state.nodes.find(n => n.id === el.dataset.id) || null;
    }

    function getEdgeCenter(node, target) {
      const targetPoint = "w" in target && "h" in target
        ? { x: target.x + target.w / 2, y: target.y + target.h / 2 }
        : { x: target.x, y: target.y };
      const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
      const dx = targetPoint.x - center.x;
      const dy = targetPoint.y - center.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        return {
          x: center.x + Math.sign(dx || 1) * (node.w / 2),
          y: center.y,
        };
      }
      return {
        x: center.x,
        y: center.y + Math.sign(dy || 1) * (node.h / 2),
      };
    }

    function getSideCenter(node, side) {
      const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
      switch (side) {
        case "left":
          return { x: node.x, y: center.y };
        case "right":
          return { x: node.x + node.w, y: center.y };
        case "top":
          return { x: center.x, y: node.y };
        case "bottom":
          return { x: center.x, y: node.y + node.h };
        default:
          return center;
      }
    }

    function snap(value) {
      if (!state.snapEnabled) return value;
      const size = state.snapSize || 10;
      return Math.round(value / size) * size;
    }

    function buildLinkPath(start, end, style) {
      if (style === "straight") {
        return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
      }
      if (style === "orthogonal") {
        const midX = (start.x + end.x) / 2;
        return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
      }
      const dx = Math.abs(end.x - start.x) * 0.4;
      return `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
    }

    function getGroupId(id) {
      const node = state.nodes.find(n => n.id === id);
      return node ? node.groupId : null;
    }

    function expandGroupSelection(ids) {
      const groupIds = new Set(
        ids.map(id => {
          const node = state.nodes.find(n => n.id === id);
          return node ? node.groupId : null;
        }).filter(Boolean)
      );
      if (!groupIds.size) return ids;
      const expanded = new Set(ids);
      state.nodes.forEach(node => {
        if (node.groupId && groupIds.has(node.groupId)) {
          expanded.add(node.id);
        }
      });
      return Array.from(expanded);
    }

    function groupSelected() {
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      const nodes = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
      if (nodes.length < 2) return;
      const groupId = crypto.randomUUID();
      nodes.forEach(node => {
        node.groupId = groupId;
      });
      state.selectedIds = nodes.map(n => n.id);
      state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null;
      updateInspector();
      render();
      pushHistory();
    }

    function ungroupSelected() {
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      const nodes = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
      if (!nodes.length) return;
      nodes.forEach(node => {
        delete node.groupId;
      });
      updateInspector();
      render();
      pushHistory();
    }

    function alignSelected(type) {
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      const nodes = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
      if (nodes.length < 2) return;
      const minX = Math.min(...nodes.map(n => n.x));
      const maxX = Math.max(...nodes.map(n => n.x + n.w));
      const minY = Math.min(...nodes.map(n => n.y));
      const maxY = Math.max(...nodes.map(n => n.y + n.h));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      nodes.forEach(node => {
        if (type === "left") node.x = minX;
        if (type === "right") node.x = maxX - node.w;
        if (type === "center") node.x = centerX - node.w / 2;
        if (type === "top") node.y = minY;
        if (type === "bottom") node.y = maxY - node.h;
        if (type === "middle") node.y = centerY - node.h / 2;
      });
      render();
      pushHistory();
    }

    function sendSelectedToBack() {
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      if (!ids[0]) return;
      const selectedSet = new Set(ids);
      const selectedNodes = state.nodes.filter(node => selectedSet.has(node.id));
      const otherNodes = state.nodes.filter(node => !selectedSet.has(node.id));
      state.nodes = [...selectedNodes, ...otherNodes];
      render();
      pushHistory();
    }

    function positionInlineEditor(node) {
      const ctm = canvas.getScreenCTM();
      if (!ctm) return;
      const center = canvas.createSVGPoint();
      center.x = node.x + node.w / 2;
      center.y = node.y + node.h / 2;
      const screen = center.matrixTransform(ctm);
      const areaRect = canvasArea.getBoundingClientRect();
      const scaleX = ctm.a || 1;
      const scaleY = ctm.d || 1;
      const width = node.w * scaleX;
      const height = 56 * scaleY;
      inlineEditor.style.width = `${width}px`;
      inlineEditor.style.height = `${height}px`;
      inlineEditor.style.left = `${screen.x - areaRect.left - width / 2}px`;
      inlineEditor.style.top = `${screen.y - areaRect.top - height / 2}px`;
    }

    function startInlineEdit(node) {
      state.editingId = node.id;
      inlineEditor.value = node.label;
      inlineEditor.dataset.original = node.label;
      inlineEditor.hidden = false;
      positionInlineEditor(node);
      inlineEditor.focus();
      inlineEditor.select();
    }

    function commitInlineEdit() {
      if (!state.editingId) return;
      const node = state.nodes.find(n => n.id === state.editingId);
      if (node) {
        node.label = inlineEditor.value;
      }
      state.editingId = null;
      inlineEditor.hidden = true;
      render();
    }

    function startDrag(event) {
      if (state.mode === "connect") return;
      const id = event.currentTarget.dataset.id;
      const node = state.nodes.find(n => n.id === id);
      if (!node) return;
      if (state.editingId) commitInlineEdit();
      if (state.resizing) return;
      const point = getSvgPoint(event);
      const isCopyDrag = event.ctrlKey || event.metaKey;
      if (isCopyDrag) {
        const ids = state.selectedIds.length ? state.selectedIds : [id];
        state.copyOnDrag = true;
        state.copyOrigin = { x: point.x, y: point.y };
        state.copySourceIds = ids.slice();
      }
      const targetId = state.selectedId || id;
      const targetNode = state.nodes.find(n => n.id === targetId);
      state.dragging = targetId;
      if (state.selectedIds.length > 1 && state.selectedIds.includes(targetId)) {
        state.dragOffset = {
          x: point.x,
          y: point.y,
        };
        state.dragGroup = state.selectedIds.map(selId => {
          const item = state.nodes.find(n => n.id === selId);
          return item ? { id: item.id, startX: item.x, startY: item.y } : null;
        }).filter(Boolean);
      } else if (targetNode) {
        state.dragOffset = {
          x: point.x - targetNode.x,
          y: point.y - targetNode.y,
        };
        state.dragGroup = null;
      }
      event.currentTarget.classList.add("dragging");
    }

    function onMouseMove(event) {
      if (state.boxSelecting) {
        const point = getSvgPoint(event);
        const x = Math.min(point.x, state.selectStart.x);
        const y = Math.min(point.y, state.selectStart.y);
        const w = Math.abs(point.x - state.selectStart.x);
        const h = Math.abs(point.y - state.selectStart.y);
        selectionRect.setAttribute("x", x);
        selectionRect.setAttribute("y", y);
        selectionRect.setAttribute("width", w);
        selectionRect.setAttribute("height", h);
        return;
      }
      if (state.resizing) {
        const { id, corner, startX, startY, startW, startH, startNodeX, startNodeY } = state.resizing;
        const node = state.nodes.find(n => n.id === id);
        if (!node) return;
        const point = getSvgPoint(event);
        const dx = point.x - startX;
        const dy = point.y - startY;
        const minW = 60;
        const minH = 40;

        let newW = startW;
        let newH = startH;
        let newX = startNodeX;
        let newY = startNodeY;

        if (corner.includes("e")) newW = startW + dx;
        if (corner.includes("w")) {
          newW = startW - dx;
          newX = startNodeX + dx;
        }
        if (corner.includes("s")) newH = startH + dy;
        if (corner.includes("n")) {
          newH = startH - dy;
          newY = startNodeY + dy;
        }

        if (newW < minW) {
          const diff = minW - newW;
          newW = minW;
          if (corner.includes("w")) newX -= diff;
        }
        if (newH < minH) {
          const diff = minH - newH;
          newH = minH;
          if (corner.includes("n")) newY -= diff;
        }

        node.w = snap(newW);
        node.h = snap(newH);
        node.x = snap(newX);
        node.y = snap(newY);
        render();
        return;
      }
      if (state.panning) {
        const dx = event.clientX - state.panStart.clientX;
        const dy = event.clientY - state.panStart.clientY;
        const viewBox = canvas.viewBox.baseVal;
        const ctm = canvas.getScreenCTM();
        const scaleX = ctm ? ctm.a : 1;
        const scaleY = ctm ? ctm.d : 1;
        viewBox.x = state.panStart.viewX - dx / scaleX;
        viewBox.y = state.panStart.viewY - dy / scaleY;
        return;
      }
      if (!state.dragging) return;
      const node = state.nodes.find(n => n.id === state.dragging);
      if (!node) return;
      const point = getSvgPoint(event);
      if (state.copyOnDrag) {
        const dx = point.x - state.copyOrigin.x;
        const dy = point.y - state.copyOrigin.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= 12) {
          const baseNodes = state.copySourceIds.map(nid => state.nodes.find(n => n.id === nid)).filter(Boolean);
          const copies = baseNodes.map(base => ({
            ...base,
            id: crypto.randomUUID(),
            x: base.x + 20,
            y: base.y + 20,
          }));
          state.nodes.push(...copies);
          state.selectedIds = copies.map(n => n.id);
          state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null;
          state.selectedLinkId = null;
          state.dragging = state.selectedId;
          state.dragGroup = null;
          state.copyOnDrag = false;
          state.copySourceIds = [];
          render();
          pushHistory();
        } else {
          return;
        }
      }
      if (state.dragGroup && state.dragGroup.length) {
        const dx = point.x - state.dragOffset.x;
        const dy = point.y - state.dragOffset.y;
        state.dragGroup.forEach(item => {
          const target = state.nodes.find(n => n.id === item.id);
          if (target) {
            target.x = snap(item.startX + dx);
            target.y = snap(item.startY + dy);
          }
        });
      } else {
        node.x = snap(point.x - state.dragOffset.x);
        node.y = snap(point.y - state.dragOffset.y);
      }
      render();
    }

    function onMouseUp() {
      if (state.boxSelecting) {
        state.boxSelecting = false;
        selectionRect.setAttribute("visibility", "hidden");
        const x = Number(selectionRect.getAttribute("x") || 0);
        const y = Number(selectionRect.getAttribute("y") || 0);
        const w = Number(selectionRect.getAttribute("width") || 0);
        const h = Number(selectionRect.getAttribute("height") || 0);
        const selected = state.nodes.filter(node => {
          const nx1 = node.x;
          const ny1 = node.y;
          const nx2 = node.x + node.w;
          const ny2 = node.y + node.h;
          const rx1 = x;
          const ry1 = y;
          const rx2 = x + w;
          const ry2 = y + h;
          return nx1 < rx2 && nx2 > rx1 && ny1 < ry2 && ny2 > ry1;
        }).map(node => node.id);

        const expanded = expandGroupSelection(selected);
        if (state.selectAdditive) {
          const merged = new Set([...state.selectedIds, ...expanded]);
          state.selectedIds = Array.from(merged);
        } else {
          state.selectedIds = expanded;
        }
        state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null;
        state.selectedLinkId = null;
        state.suppressClick = true;
        updateInspector();
        render();
        return;
      }
      if (state.resizing) {
        state.resizing = null;
        canvasArea.classList.remove("resizing");
        pushHistory();
        return;
      }
      if (state.panning) {
        state.panning = false;
        canvasArea.classList.remove("panning");
        pushHistory();
        return;
      }
      if (!state.dragging) return;
      const nodeEl = canvas.querySelector(`[data-id="${state.dragging}"]`);
      if (nodeEl) nodeEl.classList.remove("dragging");
      state.dragging = null;
      state.dragGroup = null;
      state.copyOnDrag = false;
      state.copySourceIds = [];
      pushHistory();
    }

    function resetCanvas() {
      state.nodes = [];
      state.links = [];
      state.selectedId = null;
      state.selectedIds = [];
      state.selectedLinkId = null;
      state.connectFrom = null;
      state.resizing = null;
      clearTempLine();
      updateInspector();
      render();
    }

    function exportJson() {
      const data = JSON.stringify({ version: APP_VERSION, nodes: state.nodes, links: state.links }, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date();
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("") + "_" + [
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("");
      a.download = `flowchart_${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    function importJson(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
          state.links = Array.isArray(data.links)
            ? data.links.map(link => ({
              arrow: true,
              fromSide: "left",
              toSide: "right",
              style: "curve",
              ...link,
            }))
            : [];
          state.selectedId = null;
          state.selectedLinkId = null;
          updateInspector();
          render();
          pushHistory();
        } catch (error) {
          alert("JSONの読み込みに失敗しました");
        }
      };
      reader.readAsText(file);
    }

    document.querySelectorAll("[data-add]").forEach(btn => {
      btn.addEventListener("click", () => createNode(btn.dataset.add));
    });

    document.getElementById("addStart").addEventListener("click", () => createNode("start"));
    document.getElementById("addProcess").addEventListener("click", () => createNode("process"));
    document.getElementById("addDecision").addEventListener("click", () => createNode("decision"));
    document.getElementById("addIO").addEventListener("click", () => createNode("io"));
    document.getElementById("addDashed").addEventListener("click", () => createNode("dashed"));
    document.getElementById("addText").addEventListener("click", () => createNode("text"));

    document.addEventListener("keydown", event => {
      if (event.key !== "Shift" || event.repeat) return;
      setMode("connect");
    });

    document.addEventListener("keyup", event => {
      if (event.key !== "Shift") return;
      setMode("move");
    });

    window.addEventListener("blur", () => {
      setMode("move");
    });

    document.addEventListener("keydown", event => {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier || event.shiftKey) return;
      if (event.key.toLowerCase() !== "z") return;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable)) {
        return;
      }
      if (history.index <= 0) return;
      event.preventDefault();
      history.index -= 1;
      applySnapshot(history.stack[history.index]);
    });

    document.addEventListener("keydown", event => {
      if (!state.mindmapMode) return;
      if (event.key !== "Tab" && event.key !== "Enter") return;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable)) {
        return;
      }
      const nodeId = state.selectedId || (state.selectedIds.length ? state.selectedIds[state.selectedIds.length - 1] : null);
      const baseNode = state.nodes.find(n => n.id === nodeId);
      if (!baseNode) return;
      event.preventDefault();
      const dx = event.key === "Tab" ? (baseNode.w + 60) : 0;
      const dy = event.key === "Enter" ? (baseNode.h + 40) : 0;
      const connectFromId = event.key === "Tab"
        ? baseNode.id
        : (baseNode.mindmapRootId || baseNode.id);
      duplicateNode(baseNode, dx, dy, connectFromId);
    });

    document.addEventListener("keydown", event => {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) return;
      if (event.key.toLowerCase() !== "y") return;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable)) {
        return;
      }
      if (history.index >= history.stack.length - 1) return;
      event.preventDefault();
      history.index += 1;
      applySnapshot(history.stack[history.index]);
    });

    document.addEventListener("keydown", event => {
      if (event.key !== "Delete") return;
      if (state.editingId) return;
      if (state.selectedLinkId) {
        state.links = state.links.filter(l => l.id !== state.selectedLinkId);
        state.selectedLinkId = null;
        updateInspector();
        render();
        pushHistory();
        return;
      }
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      if (!ids[0]) return;
      state.nodes = state.nodes.filter(n => !ids.includes(n.id));
      state.links = state.links.filter(l => !ids.includes(l.from) && !ids.includes(l.to));
      state.selectedId = null;
      state.selectedIds = [];
      updateInspector();
      render();
      pushHistory();
    });

    document.addEventListener("keydown", event => {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) return;
      if (event.key.toLowerCase() === "c") {
        const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
        const nodes = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
        if (!nodes.length) return;
        state.clipboard = nodes.map(node => ({ ...node }));
      }
      if (event.key.toLowerCase() === "v") {
        if (!state.clipboard || !state.clipboard.length) return;
        const offset = 30;
        const newNodes = state.clipboard.map(node => ({
          ...node,
          id: crypto.randomUUID(),
          x: node.x + offset,
          y: node.y + offset,
        }));
        state.nodes.push(...newNodes);
        state.selectedIds = newNodes.map(node => node.id);
        state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null;
        state.selectedLinkId = null;
        updateInspector();
        render();
        pushHistory();
      }
    });

    copySelectionButton.addEventListener("click", () => {
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      const nodes = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
      if (!nodes.length) return;
      state.clipboard = nodes.map(node => ({ ...node }));
    });

    document.getElementById("toggleArrow").addEventListener("click", () => {
      if (state.selectedLinkId) {
        const link = state.links.find(item => item.id === state.selectedLinkId);
        if (link) link.arrow = !link.arrow;
      } else {
        state.arrowEnabled = !state.arrowEnabled;
      }
      updateArrowButton();
      render();
    });
    document.getElementById("togglePanSelect").addEventListener("click", () => {
      state.interactionMode = state.interactionMode === "pan" ? "select" : "pan";
      updatePanSelectButton();
    });
    toggleSidebarButton.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-collapsed");
      updateSidebarButton();
    });
    toggleMindmapButton.addEventListener("click", () => {
      state.mindmapMode = !state.mindmapMode;
      updateMindmapButton();
    });
    toggleSnapButton.addEventListener("click", () => {
      state.snapEnabled = !state.snapEnabled;
      updateSnapButton();
    });
    snapSizeInput.addEventListener("change", event => {
      const value = Math.max(2, Math.min(50, Number(event.target.value) || 10));
      snapSizeInput.value = value;
      state.snapSize = value;
    });
    zoomInButton.addEventListener("click", () => zoomCanvas(0.85));
    zoomOutButton.addEventListener("click", () => zoomCanvas(1.15));
    zoomResetButton.addEventListener("click", resetZoom);
    exportPngButton.addEventListener("click", exportPng);
    document.getElementById("exportJson").addEventListener("click", exportJson);
    document.getElementById("importJson").addEventListener("click", () => document.getElementById("fileInput").click());

    document.getElementById("fileInput").addEventListener("change", event => {
      const file = event.target.files[0];
      if (file) importJson(file);
      event.target.value = "";
    });

    labelInput.addEventListener("input", event => {
      const nodeId = state.selectedId || inspectorFields.dataset.id;
      const node = state.nodes.find(n => n.id === nodeId);
      if (!node) return;
      node.label = event.target.value;
      render();
      scheduleHistory();
    });

    widthInput.addEventListener("input", event => {
      const value = Number(event.target.value);
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId || inspectorFields.dataset.id];
      ids.forEach(id => {
        const node = state.nodes.find(n => n.id === id);
        if (node) node.w = snap(value);
      });
      render();
      scheduleHistory();
    });

    heightInput.addEventListener("input", event => {
      const value = Number(event.target.value);
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId || inspectorFields.dataset.id];
      ids.forEach(id => {
        const node = state.nodes.find(n => n.id === id);
        if (node) node.h = snap(value);
      });
      render();
      scheduleHistory();
    });

    colorInput.addEventListener("change", event => {
      const value = event.target.value;
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId || inspectorFields.dataset.id];
      ids.forEach(id => {
        const node = state.nodes.find(n => n.id === id);
        if (node) node.color = value;
      });
      colorPicker.value = normalizeHexColor(value, colorPicker.value);
      render();
      scheduleHistory();
    });

    colorPicker.addEventListener("input", event => {
      const value = event.target.value;
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId || inspectorFields.dataset.id];
      ids.forEach(id => {
        const node = state.nodes.find(n => n.id === id);
        if (node) node.color = value;
      });
      colorInput.value = value;
      render();
      scheduleHistory();
    });

    fromSideSelect.addEventListener("change", event => {
      const link = state.links.find(item => item.id === state.selectedLinkId);
      if (!link) return;
      link.fromSide = event.target.value;
      render();
    });

    toSideSelect.addEventListener("change", event => {
      const link = state.links.find(item => item.id === state.selectedLinkId);
      if (!link) return;
      link.toSide = event.target.value;
      render();
    });

    linkArrowSelect.addEventListener("change", event => {
      const link = state.links.find(item => item.id === state.selectedLinkId);
      if (!link) return;
      link.arrow = event.target.value !== "off";
      render();
      pushHistory();
    });

    linkStyleSelect.addEventListener("change", event => {
      const link = state.links.find(item => item.id === state.selectedLinkId);
      if (!link) return;
      link.style = event.target.value;
      render();
      pushHistory();
    });

    defaultLinkStyle.addEventListener("change", () => {
      pushHistory();
    });

    undoLimitInput.addEventListener("change", event => {
      const value = Math.max(1, Math.min(200, Number(event.target.value) || 1));
      undoLimitInput.value = value;
      history.limit = value;
      if (history.stack.length > history.limit) {
        const drop = history.stack.length - history.limit;
        history.stack = history.stack.slice(drop);
        history.index = Math.max(history.index - drop, 0);
      }
    });

    groupNodesButton.addEventListener("click", groupSelected);
    ungroupNodesButton.addEventListener("click", ungroupSelected);
    alignLeftButton.addEventListener("click", () => alignSelected("left"));
    alignCenterButton.addEventListener("click", () => alignSelected("center"));
    alignRightButton.addEventListener("click", () => alignSelected("right"));
    alignTopButton.addEventListener("click", () => alignSelected("top"));
    alignMiddleButton.addEventListener("click", () => alignSelected("middle"));
    alignBottomButton.addEventListener("click", () => alignSelected("bottom"));
    sendToBackButton.addEventListener("click", sendSelectedToBack);

    fontSizeInput.addEventListener("input", event => {
      const nodeId = state.selectedId || inspectorFields.dataset.id;
      const node = state.nodes.find(n => n.id === nodeId);
      if (!node) return;
      node.fontSize = Number(event.target.value);
      render();
      scheduleHistory();
    });

    document.getElementById("deleteNode").addEventListener("click", () => {
      if (state.selectedLinkId) {
        state.links = state.links.filter(l => l.id !== state.selectedLinkId);
        state.selectedLinkId = null;
        updateInspector();
        render();
        pushHistory();
        return;
      }
      const ids = state.selectedIds.length ? state.selectedIds : [state.selectedId];
      if (!ids[0]) return;
      state.nodes = state.nodes.filter(n => !ids.includes(n.id));
      state.links = state.links.filter(l => !ids.includes(l.from) && !ids.includes(l.to));
      state.selectedId = null;
      state.selectedIds = [];
      updateInspector();
      render();
      pushHistory();
    });

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    canvasArea.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      if (isNodeTarget(event.target)) return;
      if (state.editingId) commitInlineEdit();
      const point = getSvgPoint(event);
      if (state.interactionMode === "pan") {
        const viewBox = canvas.viewBox.baseVal;
        state.panning = true;
        state.panStart = {
          x: point.x,
          y: point.y,
          viewX: viewBox.x,
          viewY: viewBox.y,
          clientX: event.clientX,
          clientY: event.clientY,
        };
        canvasArea.classList.add("panning");
      } else {
        state.boxSelecting = true;
        state.selectAdditive = event.ctrlKey || event.metaKey;
        state.selectStart = { x: point.x, y: point.y };
        selectionRect.setAttribute("x", point.x);
        selectionRect.setAttribute("y", point.y);
        selectionRect.setAttribute("width", 0);
        selectionRect.setAttribute("height", 0);
        selectionRect.setAttribute("visibility", "visible");
      }
      event.preventDefault();
    });
    canvas.addEventListener("click", event => {
      if (event.detail && event.detail > 1) return;
      if (state.suppressClick) {
        state.suppressClick = false;
        return;
      }
      if (state.editingId) commitInlineEdit();
      state.selectedLinkId = null;
      selectNode(null);
    });

    canvasArea.addEventListener("click", event => {
      if (event.detail !== 2) return;
      if (state.mode === "connect") return;
      const node = findNodeFromEvent(event);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      startInlineEdit(node);
    }, true);

    canvas.addEventListener("dblclick", event => {
      if (state.mode === "connect") return;
      const node = findNodeFromEvent(event);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      startInlineEdit(node);
    });

    inlineEditor.addEventListener("blur", commitInlineEdit);
    inlineEditor.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        inlineEditor.blur();
      }
      if (event.key === "Escape") {
        inlineEditor.value = inlineEditor.dataset.original || "";
        inlineEditor.blur();
      }
    });

    setMode("move");
    render();
    if (appVersion) appVersion.textContent = `Version: ${APP_VERSION}`;
    pushHistory();

    function normalizeHexColor(value, fallback) {
      if (typeof value !== "string") return fallback;
      const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      return match ? (match[1].length === 3 ? `#${match[1].split("").map(c => c + c).join("")}` : value) : fallback;
    }

    function addResizeHandles(group, node) {
      const handles = [
        { corner: "nw", x: 0, y: 0 },
        { corner: "ne", x: node.w, y: 0 },
        { corner: "sw", x: 0, y: node.h },
        { corner: "se", x: node.w, y: node.h },
      ];
      handles.forEach(handle => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.classList.add("resize-handle", `handle-${handle.corner}`);
        circle.setAttribute("cx", handle.x);
        circle.setAttribute("cy", handle.y);
        circle.setAttribute("r", 6);
        circle.addEventListener("mousedown", event => {
          event.stopPropagation();
          const point = getSvgPoint(event);
          state.resizing = {
            id: node.id,
            corner: handle.corner,
            startX: point.x,
            startY: point.y,
            startW: node.w,
            startH: node.h,
            startNodeX: node.x,
            startNodeY: node.y,
          };
          canvasArea.classList.add("resizing");
        });
        group.appendChild(circle);
      });
    }


