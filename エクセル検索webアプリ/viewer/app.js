const state = {
  index: null,
  sheets: [],          // {sheet, file, rows, cols, ...}
  current: null,       // sheet item
  cache: new Map(),    // file -> sheetJson
};

const el = (id) => document.getElementById(id);

function setStatus(msg) {
  el("status").textContent = msg;
}

function setResultsMeta(msg) {
  const node = el("resultsMeta");
  if (node) node.textContent = msg || "";
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightText(text, q) {
  if (!q) return escapeHtml(text);
  const safe = escapeHtml(text);
  // 簡易ハイライト（大文字小文字無視）
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}

async function fetchJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch failed: ${path} (${r.status})`);
  return await r.json();
}

async function loadIndex() {
  const idx = await fetchJson("data/index.json");
  state.index = idx;
  state.sheets = idx.sheets || [];
  el("meta").textContent = `生成: ${idx.generated_at} / シート数: ${state.sheets.length}`;
  renderSheetList();
}

function renderSheetList() {
  const list = el("sheetList");
  list.innerHTML = "";

  state.sheets.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "sheetItem";
    div.dataset.file = s.file;

    div.innerHTML = `
      <div class="name">${escapeHtml(s.sheet)}</div>
      <div class="sub">rows: ${s.rows}, cols: ${s.cols} / header: ${s.header_rows?.[0]}-${s.header_rows?.[1]}</div>
    `;

    div.addEventListener("click", () => openSheetByIndex(i));
    list.appendChild(div);
  });
}

function setActiveSheetItem(file) {
  document.querySelectorAll(".sheetItem").forEach((x) => {
    x.classList.toggle("active", x.dataset.file === file);
  });
}

async function getSheetJson(sheetItem) {
  if (state.cache.has(sheetItem.file)) return state.cache.get(sheetItem.file);
  const json = await fetchJson(`data/${sheetItem.file}`);
  state.cache.set(sheetItem.file, json);
  return json;
}

function renderTable(sheetJson, q) {
  const tbl = el("tbl");
  const columns = sheetJson.columns || [];
  const rows = sheetJson.rows || [];

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  const qNorm = (q || "").trim();
  for (let r = 0; r < rows.length; r++) {
    const tr = document.createElement("tr");
    tr.className = "row";
    tr.dataset.row = String(r);
    const row = rows[r];
    for (let c = 0; c < columns.length; c++) {
      const td = document.createElement("td");
      const cell = (row[c] ?? "").toString();
      td.innerHTML = highlightText(cell, qNorm);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  tbl.innerHTML = "";
  tbl.appendChild(thead);
  tbl.appendChild(tbody);
}

function clearRowFocus() {
  document.querySelectorAll(".row.focused").forEach((x) => x.classList.remove("focused"));
}

function focusRow(rowIndex) {
  const wrap = el("tableWrap");
  const row = wrap.querySelector(`tbody tr[data-row="${rowIndex}"]`);
  if (!row) return;
  clearRowFocus();
  row.classList.add("focused");
  row.scrollIntoView({ block: "center" });
}

async function openSheetByIndex(i, opts = {}) {
  const item = state.sheets[i];
  state.current = item;
  setActiveSheetItem(item.file);

  setStatus(`読み込み: ${item.sheet} ...`);
  const sheetJson = await getSheetJson(item);

  el("sheetTitle").textContent = item.sheet;
  el("sheetInfo").textContent = `rows: ${item.rows}, cols: ${item.cols} / data_start: ${item.data_start_row}`;

  const q = el("q").value.trim();
  renderTable(sheetJson, q);
  clearRowFocus();

  if (!opts.preserveResults) {
    el("results").innerHTML = "";
    setResultsMeta("");
  }
  setStatus(`表示中: ${item.sheet}`);
}

function currentQuery() {
  return el("q").value.trim();
}

function isAllScope() {
  return el("scopeAll").checked;
}

function normalizeForSearch(s) {
  return (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

async function searchCurrentSheet(q) {
  if (!state.current) return { hits: [], total: 0 };
  const item = state.current;
  const sheetJson = await getSheetJson(item);
  const rowText = sheetJson.rowText || [];
  const rows = sheetJson.rows || [];

  const qn = normalizeForSearch(q);
  if (!qn) return { hits: [], total: rows.length };

  const hits = [];
  for (let i = 0; i < rowText.length; i++) {
    if (rowText[i].includes(qn)) {
      hits.push({ sheet: item.sheet, file: item.file, rowIndex: i, snippet: rows[i].join(" | ") });
      if (hits.length >= 200) break; // 多すぎると重いので上限
    }
  }
  return { hits, total: rowText.length };
}

async function searchAllSheets(q) {
  const qn = normalizeForSearch(q);
  if (!qn) return { hits: [], scannedSheets: 0 };

  const hits = [];
  let scannedSheets = 0;

  // まずは「今開いてるシート」から（体感改善）
  const order = [];
  if (state.current) order.push(state.current);
  for (const s of state.sheets) {
    if (!state.current || s.file !== state.current.file) order.push(s);
  }

  for (const item of order) {
    const sheetJson = await getSheetJson(item);
    scannedSheets++;

    const rowText = sheetJson.rowText || [];
    const rows = sheetJson.rows || [];

    for (let i = 0; i < rowText.length; i++) {
      if (rowText[i].includes(qn)) {
        hits.push({ sheet: item.sheet, file: item.file, rowIndex: i, snippet: rows[i].join(" | ") });
        if (hits.length >= 300) break;
      }
    }
    if (hits.length >= 300) break;
  }

  return { hits, scannedSheets };
}

function renderHits(hits, infoText) {
  const box = el("results");
  setResultsMeta(infoText || "");
  if (!hits.length) {
    box.innerHTML = `<div>No hits</div>`;
    return;
  }

  box.innerHTML = hits.map((h) => {
    const title = `${h.sheet} / row ${h.rowIndex + 1}`;
    const snippet = h.snippet.length > 220 ? (h.snippet.slice(0, 220) + " ...") : h.snippet;
    return `
      <div class="hit" data-file="${escapeHtml(h.file)}" data-row="${h.rowIndex}">
        <div class="title">${escapeHtml(title)}</div>
        <div class="snippet">${escapeHtml(snippet)}</div>
      </div>
    `;
  }).join("");

  box.querySelectorAll(".hit").forEach((node) => {
    node.addEventListener("click", async () => {
      const file = node.dataset.file;
      const rowIndex = Number(node.dataset.row);

      const idx = state.sheets.findIndex(s => s.file === file);
      if (idx >= 0) {
        await openSheetByIndex(idx, { preserveResults: true });
        requestAnimationFrame(() => focusRow(rowIndex));
      }
    });
  });
}

let searchTimer = null;

function setupEvents() {
  el("q").addEventListener("input", () => {
    // 入力のたびに重い検索を回さない
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearchAndRender, 150);
  });

  el("scopeAll").addEventListener("change", () => {
    runSearchAndRender();
  });

  el("clearBtn").addEventListener("click", async () => {
    el("q").value = "";
    el("results").innerHTML = "";
    setResultsMeta("");
    if (state.current) {
      const sheetJson = await getSheetJson(state.current);
      renderTable(sheetJson, "");
      clearRowFocus();
    }
  });
}

async function runSearchAndRender() {
  const q = currentQuery();

  // 表の表示（現在シートを開いているときはセルもハイライト）
  if (state.current) {
    const sheetJson = await getSheetJson(state.current);
    renderTable(sheetJson, q);
  }

  // 横断/現在シート検索の結果
  if (!q) {
    el("results").innerHTML = "";
    setResultsMeta("");
    return;
  }

  if (!isAllScope()) {
    const r = await searchCurrentSheet(q);
    renderHits(r.hits, `Current sheet hits: ${r.hits.length} (max 200)`);
  } else {
    setStatus("全シート検索中...");
    const r = await searchAllSheets(q);
    renderHits(r.hits, `All sheets hits: ${r.hits.length} (max 300) / Scanned: ${r.scannedSheets}`);
    setStatus(state.current ? `表示中: ${state.current.sheet}` : "準備完了");
  }
}

async function main() {
  try {
    setStatus("index.json 読み込み中...");
    await loadIndex();
    setupEvents();

    if (state.sheets.length) {
      await openSheetByIndex(0);
    } else {
      setStatus("シートが見つかりません");
    }
  } catch (e) {
    console.error(e);
    setStatus(`エラー: ${e.message}`);
  }
}

main();
