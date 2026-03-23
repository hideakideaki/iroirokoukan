(() => {
  /** App Core: state */
  const state = {
    project: {
      activeTableKey: "",
      activeFileName: "",
      activeSheetName: "",
      filePathMemo: ""
    },
    raw: {
      files: {}
    },
    normalized: {
      tables: {}
    },
    settings: {
      defaults: {
        colHeaderRowStart: 1,
        colHeaderRowCount: 1,
        rowHeaderColStart: 1,
        rowHeaderColCount: 1,
        dataRowStart: 2,
        dataColStart: 2,
        autoFillDataStart: true,
        filePathMemo: ""
      },
      perTable: {},
      pendingImport: null
    },
    results: {
      lastSearch: []
    },
    logs: []
  };

  /** DOM */
  const $ = (id) => document.getElementById(id);

  const fileEl = $("file");
  const sheetSelect = $("sheetSelect");
  const fileStatus = $("fileStatus");
  const deleteTableSelect = $("deleteTableSelect");
  const deleteTableBtn = $("deleteTableBtn");
  const deleteFileSelect = $("deleteFileSelect");
  const deleteFileBtn = $("deleteFileBtn");
  const loadedFilesList = $("loadedFilesList");
  const memoryEstimate = $("memoryEstimate");

  const colHeaderRowStart = $("colHeaderRowStart");
  const colHeaderRowCount = $("colHeaderRowCount");
  const rowHeaderColStart = $("rowHeaderColStart");
  const rowHeaderColCount = $("rowHeaderColCount");
  const dataRowStart      = $("dataRowStart");
  const dataColStart      = $("dataColStart");
  const autoFillDataStart = $("autoFillDataStart");
  const rowHeaderColLetters = $("rowHeaderColLetters");
  const dataColLetters = $("dataColLetters");

  const applySettings = $("applySettings");
  const settingsStatus = $("settingsStatus");
  const currentSettings = $("currentSettings");
  const exportSettingsBtn = $("exportSettingsBtn");
  const importSettingsBtn = $("importSettingsBtn");
  const importSettingsFile = $("importSettingsFile");
  const filePathMemo = $("filePathMemo");

  const queryEl = $("query");
  const modeEl  = $("mode");
  const caseEl  = $("case");
  const runSearch = $("runSearch");
  const searchStatus = $("searchStatus");

  const rowHeaderQuery = $("rowHeaderQuery");
  const rowHeaderExcludeValue = $("rowHeaderExcludeValue");
  const runRowHeaderScan = $("runRowHeaderScan");
  const rowHeaderStatus = $("rowHeaderStatus");

  const resultsBody = $("resultsBody");
  const metaPill = $("metaPill");
  const downloadResults = $("downloadResults");
  const colHeaderList = $("colHeaderList");
  const rowHeaderList = $("rowHeaderList");
  const resultFilter = $("resultFilter");
  const resultFilterColumn = $("resultFilterColumn");
  const resultFilterStatus = $("resultFilterStatus");
  const resultGroupBy = $("resultGroupBy");

  /** Utilities */
  function toInt(el) {
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) ? v : 1;
  }
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
  function cellToString(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
  function joinParts(parts) {
    const cleaned = parts.map(s => cellToString(s).trim()).filter(s => s !== "");
    return cleaned.join(" / ");
  }
  function setStatus(el, text, cls) {
    el.className = "status " + (cls || "");
    el.textContent = text;
  }
  function pad3(n) {
    return String(n).padStart(3, "0");
  }
  function tableKey(fileName, sheetName) {
    return `${fileName}::${sheetName}`;
  }
  function parseTableKey(key) {
    const idx = key.indexOf("::");
    if (idx === -1) return { fileName: "", sheetName: key };
    return {
      fileName: key.slice(0, idx),
      sheetName: key.slice(idx + 2)
    };
  }
  function ensureTableSettings(key) {
    if (!state.settings.perTable[key]) {
      state.settings.perTable[key] = {
        ...state.settings.defaults,
        filePathMemo: ""
      };
    }
    if (typeof state.settings.perTable[key].filePathMemo !== "string") {
      state.settings.perTable[key].filePathMemo = "";
    }
    return state.settings.perTable[key];
  }
  function getActiveTableKey() {
    return state.project.activeTableKey;
  }
  function formatTableLabel(fileName, sheetName) {
    return fileName ? `${fileName} / ${sheetName}` : sheetName;
  }
  function makeUniqueFileName(baseName) {
    if (!state.raw.files[baseName]) return baseName;
    let idx = 2;
    while (state.raw.files[`${baseName} (${idx})`]) idx += 1;
    return `${baseName} (${idx})`;
  }
  function listRawTableKeys() {
    const keys = [];
    Object.values(state.raw.files).forEach((file) => {
      Object.keys(file.sheets).forEach((sheetName) => {
        keys.push(tableKey(file.fileName, sheetName));
      });
    });
    return keys;
  }
  function rebuildTableOptions() {
    const keys = listRawTableKeys();
    sheetSelect.innerHTML = "";
    keys.forEach((key) => {
      const { fileName, sheetName } = parseTableKey(key);
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = formatTableLabel(fileName, sheetName);
      sheetSelect.appendChild(opt);
    });
    if (state.project.activeTableKey) {
      sheetSelect.value = state.project.activeTableKey;
    }
  }
  function rebuildDeleteOptions() {
    const keys = listRawTableKeys();
    deleteTableSelect.innerHTML = "";
    keys.forEach((key) => {
      const { fileName, sheetName } = parseTableKey(key);
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = formatTableLabel(fileName, sheetName);
      deleteTableSelect.appendChild(opt);
    });

    const fileNames = Object.keys(state.raw.files);
    deleteFileSelect.innerHTML = "";
    fileNames.forEach((fileName) => {
      const opt = document.createElement("option");
      opt.value = fileName;
      opt.textContent = fileName;
      deleteFileSelect.appendChild(opt);
    });

    const hasTables = keys.length > 0;
    const hasFiles = fileNames.length > 0;
    deleteTableSelect.disabled = !hasTables;
    deleteTableBtn.disabled = !hasTables;
    deleteFileSelect.disabled = !hasFiles;
    deleteFileBtn.disabled = !hasFiles;
  }
  function updateLoadedFilesUI() {
    const fileNames = Object.keys(state.raw.files);
    if (fileNames.length === 0) {
      loadedFilesList.textContent = "None";
      memoryEstimate.textContent = "Memory estimate: -";
      return;
    }

    const lines = fileNames.map((name) => {
      const sheetCount = Object.keys(state.raw.files[name].sheets).length;
      return `${name} (${sheetCount} sheets)`;
    });
    loadedFilesList.textContent = lines.join("\n");
    memoryEstimate.textContent = `Memory estimate: ${formatBytes(estimateMemoryBytes())}`;
  }
  function estimateMemoryBytes() {
    let total = 0;
    Object.values(state.raw.files).forEach((file) => {
      Object.values(file.sheets).forEach((sheet) => {
        const aoa = sheet.aoa || [];
        for (let r = 0; r < aoa.length; r++) {
          const row = aoa[r] || [];
          for (let c = 0; c < row.length; c++) {
            const v = row[c];
            if (v === null || v === undefined) continue;
            if (typeof v === "string") {
              total += v.length * 2;
            } else if (typeof v === "number") {
              total += 8;
            } else if (typeof v === "boolean") {
              total += 4;
            } else if (v instanceof Date) {
              total += 8;
            }
          }
        }
      });
    });
    return total;
  }
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx += 1;
    }
    return `${val.toFixed(val < 10 && idx > 0 ? 2 : 1)} ${units[idx]}`;
  }
  function setActiveTable(key) {
    const { fileName, sheetName } = parseTableKey(key);
    state.project.activeTableKey = key;
    state.project.activeFileName = fileName;
    state.project.activeSheetName = sheetName;
    const settings = ensureTableSettings(key);
    state.project.filePathMemo = settings.filePathMemo || "";
    applySettingsToUI(settings);
    sheetSelect.value = key;
  }
  function clearActiveTable() {
    state.project.activeTableKey = "";
    state.project.activeFileName = "";
    state.project.activeSheetName = "";
    state.project.filePathMemo = "";
    sheetSelect.value = "";
  }
  function refreshAfterDelete() {
    const keys = listRawTableKeys();
    rebuildTableOptions();
    rebuildDeleteOptions();
    updateLoadedFilesUI();
    if (keys.length === 0) {
      clearActiveTable();
      applySettings.disabled = true;
      runSearch.disabled = true;
      runRowHeaderScan.disabled = true;
      resetResultsUI();
      return;
    }
    if (!keys.includes(state.project.activeTableKey)) {
      setActiveTable(keys[0]);
    }
    applySettings.disabled = false;
    runSearch.disabled = false;
    runRowHeaderScan.disabled = false;
  }
  function deleteTableByKey(key) {
    const { fileName, sheetName } = parseTableKey(key);
    const file = state.raw.files[fileName];
    if (file && file.sheets[sheetName]) {
      delete file.sheets[sheetName];
    }
    delete state.normalized.tables[key];
    delete state.settings.perTable[key];
    if (file && Object.keys(file.sheets).length === 0) {
      delete state.raw.files[fileName];
    }
    refreshAfterDelete();
  }
  function deleteFileByName(fileName) {
    const keys = listRawTableKeys().filter((key) => {
      const parsed = parseTableKey(key);
      return parsed.fileName === fileName;
    });
    keys.forEach((key) => {
      delete state.normalized.tables[key];
      delete state.settings.perTable[key];
    });
    delete state.raw.files[fileName];
    refreshAfterDelete();
  }

  function readSettingsFromUI() {
    return {
      colHeaderRowStart: toInt(colHeaderRowStart),
      colHeaderRowCount: toInt(colHeaderRowCount),
      rowHeaderColStart: toInt(rowHeaderColStart),
      rowHeaderColCount: toInt(rowHeaderColCount),
      dataRowStart: toInt(dataRowStart),
      dataColStart: toInt(dataColStart),
      autoFillDataStart: !!autoFillDataStart.checked,
      filePathMemo: (filePathMemo.value || "").trim()
    };
  }
  function toPositiveInt(value, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return n;
  }
  function sanitizeSettings(candidate, fallback) {
    const src = candidate && typeof candidate === "object" ? candidate : {};
    return {
      colHeaderRowStart: toPositiveInt(src.colHeaderRowStart, fallback.colHeaderRowStart),
      colHeaderRowCount: toPositiveInt(src.colHeaderRowCount, fallback.colHeaderRowCount),
      rowHeaderColStart: toPositiveInt(src.rowHeaderColStart, fallback.rowHeaderColStart),
      rowHeaderColCount: toPositiveInt(src.rowHeaderColCount, fallback.rowHeaderColCount),
      dataRowStart: toPositiveInt(src.dataRowStart, fallback.dataRowStart),
      dataColStart: toPositiveInt(src.dataColStart, fallback.dataColStart),
      autoFillDataStart: typeof src.autoFillDataStart === "boolean"
        ? src.autoFillDataStart
        : !!fallback.autoFillDataStart,
      filePathMemo: typeof src.filePathMemo === "string"
        ? src.filePathMemo
        : (fallback.filePathMemo || "")
    };
  }
  function buildSettingsSnapshot() {
    const defaults = sanitizeSettings(state.settings.defaults, state.settings.defaults);
    const perTable = {};
    Object.entries(state.settings.perTable).forEach(([key, value]) => {
      perTable[key] = sanitizeSettings(value, defaults);
    });
    const activeTableKey = getActiveTableKey();
    return {
      schema: "excel-search-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      selection: {
        activeTableKey,
        activeFileName: state.project.activeFileName || "",
        activeSheetName: state.project.activeSheetName || "",
        filePathMemo: state.project.filePathMemo || "",
        loadedTableKeys: listRawTableKeys()
      },
      defaults,
      perTable
    };
  }
  function resolveImportedSelection(payload) {
    if (!payload || typeof payload !== "object") return "";
    const selection = payload.selection;
    if (!selection || typeof selection !== "object") return "";
    const activeTableKey = typeof selection.activeTableKey === "string"
      ? selection.activeTableKey
      : "";
    if (!activeTableKey) return "";
    return listRawTableKeys().includes(activeTableKey) ? activeTableKey : "";
  }
  function setPendingImportedSelection(payload) {
    if (!payload || typeof payload !== "object") {
      state.settings.pendingImport = null;
      return;
    }
    const selection = payload.selection && typeof payload.selection === "object"
      ? payload.selection
      : null;
    const activeTableKey = selection && typeof selection.activeTableKey === "string"
      ? selection.activeTableKey
      : "";
    state.settings.pendingImport = activeTableKey
      ? {
          activeTableKey,
          filePathMemo: selection && typeof selection.filePathMemo === "string"
            ? selection.filePathMemo
            : ""
        }
      : null;
  }
  function consumePendingImportedSelection() {
    const pending = state.settings.pendingImport;
    if (!pending || !pending.activeTableKey) return "";
    if (!listRawTableKeys().includes(pending.activeTableKey)) return "";
    state.settings.pendingImport = null;
    return pending.activeTableKey;
  }
  function applyImportedSettings(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("設定JSONの形式が不正です。");
    }
    const importedDefaults = sanitizeSettings(payload.defaults, state.settings.defaults);
    const importedPerTable = payload.perTable && typeof payload.perTable === "object"
      ? payload.perTable
      : {};
    const sanitizedPerTable = {};
    Object.entries(importedPerTable).forEach(([key, value]) => {
      if (typeof key !== "string" || !key) return;
      sanitizedPerTable[key] = sanitizeSettings(value, importedDefaults);
    });
    state.settings.defaults = importedDefaults;
    state.settings.perTable = { ...state.settings.perTable, ...sanitizedPerTable };
    setPendingImportedSelection(payload);
    return {
      importedCount: Object.keys(sanitizedPerTable).length,
      selectedTableKey: resolveImportedSelection(payload),
      importedFilePathMemo: payload.selection && typeof payload.selection.filePathMemo === "string"
        ? payload.selection.filePathMemo
        : ""
    };
  }
  function downloadSettingsJson(payload) {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date();
    a.href = url;
    a.download = `excel_search_settings_${ts.getFullYear()}${pad2(ts.getMonth() + 1)}${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}${pad2(ts.getSeconds())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applySettingsToUI(settings) {
    colHeaderRowStart.value = settings.colHeaderRowStart;
    colHeaderRowCount.value = settings.colHeaderRowCount;
    rowHeaderColStart.value = settings.rowHeaderColStart;
    rowHeaderColCount.value = settings.rowHeaderColCount;
    dataRowStart.value = settings.dataRowStart;
    dataColStart.value = settings.dataColStart;
    autoFillDataStart.checked = !!settings.autoFillDataStart;
    filePathMemo.value = settings.filePathMemo || "";
    state.project.filePathMemo = settings.filePathMemo || "";
    updateRowHeaderLetters();
    updateDataColLetters();
    updateCurrentSettingsCard(settings);
  }
  function updateCurrentSettingsCard(settings) {
    if (!settings) {
      currentSettings.textContent = "未作成";
      return;
    }
    currentSettings.textContent =
      `列ヘッダ開始行=${settings.colHeaderRowStart}、行数=${settings.colHeaderRowCount} / ` +
      `行ヘッダ開始列=${settings.rowHeaderColStart}、列数=${settings.rowHeaderColCount} / ` +
      `ファイルパス=${settings.filePathMemo || "(未入力)"}`;
  }

  function updateDefaultDataRowStart() {
    if (!autoFillDataStart.checked) return;
    const start = Math.max(1, toInt(colHeaderRowStart));
    const count = Math.max(1, toInt(colHeaderRowCount));
    dataRowStart.value = start + count;
  }
  function updateDefaultDataColStart() {
    if (!autoFillDataStart.checked) return;
    const start = Math.max(1, toInt(rowHeaderColStart));
    const count = Math.max(1, toInt(rowHeaderColCount));
    dataColStart.value = start + count;
    updateDataColLetters();
  }
  function colIndexToLetters(n) {
    let num = n;
    let out = "";
    while (num > 0) {
      const mod = (num - 1) % 26;
      out = String.fromCharCode(65 + mod) + out;
      num = Math.floor((num - 1) / 26);
    }
    return out || "-";
  }
  function updateRowHeaderLetters() {
    const start = Math.max(1, toInt(rowHeaderColStart));
    const count = Math.max(1, toInt(rowHeaderColCount));
    const startLetter = colIndexToLetters(start);
    const endLetter = colIndexToLetters(start + count - 1);
    rowHeaderColLetters.textContent = `行ヘッダ列記号: ${startLetter}-${endLetter}`;
  }
  function updateDataColLetters() {
    const col = Math.max(1, toInt(dataColStart));
    dataColLetters.textContent = `データ開始列記号: ${colIndexToLetters(col)}`;
  }

  function resetResultsUI() {
    state.results.lastSearch = [];
    downloadResults.disabled = true;
    renderResults([]);
    setStatus(searchStatus, "未実行", "");
    setStatus(rowHeaderStatus, "未実行", "");
    resultFilterStatus.textContent = "";
  }

  function log(msg) {
    state.logs.push({ ts: Date.now(), msg });
  }

  /** Storage Facade */
  const storage = {
    putTable(tableName, normalizedTable) {
      state.normalized.tables[tableName] = normalizedTable;
    },
    getTable(tableName) {
      return state.normalized.tables[tableName] || null;
    },
    listTables() {
      return Object.keys(state.normalized.tables);
    }
  };

  /** Importer */
  const Importer = {
    async importFile(file) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheets = {};
      wb.SheetNames.forEach((name) => {
        const ws = wb.Sheets[name];
        sheets[name] = { aoa: this.sheetToMatrix(ws) };
      });
      return { workbook: wb, sheets };
    },
    sheetToMatrix(ws) {
      // header:1 で 2D array。defval で空セルを明示。
      // 先頭の空行/空列がある場合に備えて、範囲の開始を A1 に固定する。
      const ref = ws["!ref"] || "A1";
      const range = XLSX.utils.decode_range(ref);
      range.s = { r: 0, c: 0 };
      return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", range });
    }
  };

  /** Normalizer */
  const Normalizer = {
    normalizeTable(fileName, sheetName, aoa, settings) {
      const maxRows = aoa.length;
      const maxCols = Math.max(0, ...aoa.map(r => (r ? r.length : 0)));

      // 1-based -> 0-based
      let chrS = settings.colHeaderRowStart - 1;
      let chrCount = settings.colHeaderRowCount;
      let chrE = chrS + chrCount - 1;
      let rhcS = settings.rowHeaderColStart - 1;
      let rhcCount = settings.rowHeaderColCount;
      let rhcE = rhcS + rhcCount - 1;
      let drS  = settings.dataRowStart - 1;
      let dcS  = settings.dataColStart - 1;

      // clamp
      chrS = clamp(chrS, 0, Math.max(0, maxRows - 1));
      chrCount = Math.max(1, chrCount);
      chrE = chrS + chrCount - 1;
      chrE = clamp(chrE, 0, Math.max(0, maxRows - 1));
      if (chrE < chrS) [chrS, chrE] = [chrE, chrS];

      rhcS = clamp(rhcS, 0, Math.max(0, maxCols - 1));
      rhcCount = Math.max(1, rhcCount);
      rhcE = rhcS + rhcCount - 1;
      rhcE = clamp(rhcE, 0, Math.max(0, maxCols - 1));
      if (rhcE < rhcS) [rhcS, rhcE] = [rhcE, rhcS];

      drS = clamp(drS, 0, Math.max(0, maxRows));
      dcS = clamp(dcS, 0, Math.max(0, maxCols));

      const warnings = [];
      if (drS <= chrE) warnings.push("データ開始行が列ヘッダ行と重なっています");
      if (dcS <= rhcE) warnings.push("データ開始列が行ヘッダ列と重なっています");

      const bounds = { maxRows, maxCols, chrS, chrE, rhcS, rhcE, drS, dcS };

      // columns
      const columns = [];
      for (let c = dcS; c < maxCols; c++) {
        const headerParts = [];
        for (let r = chrS; r <= chrE; r++) {
          headerParts.push((aoa[r] && aoa[r][c] !== undefined) ? aoa[r][c] : "");
        }
        const headerText = joinParts(headerParts);
        const id = `col_${pad3(c - dcS + 1)}`;
        columns.push({ id, index: c + 1, headerPath: headerParts, headerText });
      }

      // row headers (data rows only)
      const rowHeaders = [];
      for (let r = drS; r < maxRows; r++) {
        const parts = [];
        for (let c = rhcS; c <= rhcE; c++) {
          parts.push((aoa[r] && aoa[r][c] !== undefined) ? aoa[r][c] : "");
        }
        rowHeaders.push({
          rowIndex: r + 1,
          headerParts: parts,
          headerText: joinParts(parts)
        });
      }

      // rows (data area)
      const rows = [];
      for (let r = drS; r < maxRows; r++) {
        const row = aoa[r] || [];
        const rowObj = {};
        columns.forEach((col, idx) => {
          const c = dcS + idx;
          const val = (row[c] !== undefined) ? row[c] : "";
          rowObj[col.id] = cellToString(val);
        });
        rows.push(rowObj);
      }

      const table = {
        key: tableKey(fileName, sheetName),
        name: sheetName,
        fileName,
        bounds,
        columns,
        rows,
        rowHeaders
      };
      return { table, warnings };
    }
  };

  /** Analyzer */
  const Analyzer = {
    searchTable(table, q, mode, cs) {
      const matcher = buildMatcher(q, mode, cs);
      if (!matcher) return { error: "empty" };

      const results = [];
      const b = table.bounds;

      const label = formatTableLabel(table.fileName, table.name);
      for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
        const rowObj = table.rows[rIdx];
        for (let cIdx = 0; cIdx < table.columns.length; cIdx++) {
          const col = table.columns[cIdx];
          const val = rowObj[col.id];
          const s = cellToString(val);
          if (matcher(s)) {
            results.push({
              sheet: label,
              row: b.drS + rIdx + 1,
              col: col.index,
              rowHeaderText: table.rowHeaders[rIdx] ? table.rowHeaders[rIdx].headerText : "",
              colHeaderText: col.headerText,
              colId: col.id,
              value: s
            });
          }
        }
      }
      return { results };
    },

    scanRowHeaderNotDash(table, q, mode, cs, excludeValue) {
      const matcher = buildMatcher(q, mode, cs);
      if (!matcher) return { error: "empty" };

      const results = [];
      const b = table.bounds;
      const exclude = (excludeValue ?? "").trim();

      const label = formatTableLabel(table.fileName, table.name);
      for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
        const rhText = table.rowHeaders[rIdx] ? table.rowHeaders[rIdx].headerText : "";
        if (!matcher(rhText)) continue;

        const rowObj = table.rows[rIdx];
        for (let cIdx = 0; cIdx < table.columns.length; cIdx++) {
          const col = table.columns[cIdx];
          const s = cellToString(rowObj[col.id]).trim();
          if (s === "") continue;
          if (exclude !== "" && s === exclude) continue;

          results.push({
            sheet: label,
            row: b.drS + rIdx + 1,
            col: col.index,
            rowHeaderText: rhText,
            colHeaderText: col.headerText,
            colId: col.id,
            value: s
          });
        }
      }
      return { results };
    }
  };

  /** Export */
  const ExportService = {
    exportSearchResults(results) {
      if (!results || results.length === 0) return;

      const header = ["#", "sheet", "row", "col", "rowHeader", "colHeader", "value"];
      const csv = [
        header.join(","),
        ...results.map((r, i) => [
          i + 1,
          csvEscape(r.sheet),
          r.row,
          r.col,
          csvEscape(r.rowHeaderText),
          csvEscape(r.colHeaderText),
          csvEscape(r.value)
        ].join(","))
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date();
      const name = `excel_search_results_${ts.getFullYear()}${pad2(ts.getMonth()+1)}${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}${pad2(ts.getSeconds())}.csv`;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };

  /** UI events */
  resultFilter.addEventListener("input", () => {
    renderResults(state.results.lastSearch);
  });
  resultFilterColumn.addEventListener("change", () => {
    renderResults(state.results.lastSearch);
  });
  resultGroupBy.addEventListener("change", () => {
    renderResults(state.results.lastSearch);
  });

  colHeaderRowStart.addEventListener("input", updateDefaultDataRowStart);
  colHeaderRowCount.addEventListener("input", updateDefaultDataRowStart);
  rowHeaderColStart.addEventListener("input", updateDefaultDataColStart);
  rowHeaderColCount.addEventListener("input", updateDefaultDataColStart);
  rowHeaderColStart.addEventListener("input", updateRowHeaderLetters);
  rowHeaderColCount.addEventListener("input", updateRowHeaderLetters);
  dataColStart.addEventListener("input", updateDataColLetters);
  colHeaderRowStart.addEventListener("input", () => updateCurrentSettingsCard(readSettingsFromUI()));
  colHeaderRowCount.addEventListener("input", () => updateCurrentSettingsCard(readSettingsFromUI()));
  rowHeaderColStart.addEventListener("input", () => updateCurrentSettingsCard(readSettingsFromUI()));
  rowHeaderColCount.addEventListener("input", () => updateCurrentSettingsCard(readSettingsFromUI()));
  filePathMemo.addEventListener("input", () => updateCurrentSettingsCard(readSettingsFromUI()));

  fileEl.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      setStatus(fileStatus, "読み込み中...", "");

      for (const file of files) {
        const imported = await Importer.importFile(file);
        const uniqueName = makeUniqueFileName(file.name);
        state.raw.files[uniqueName] = {
          fileName: uniqueName,
          workbook: imported.workbook,
          sheets: imported.sheets
        };

        if (!state.project.activeTableKey) {
          const firstSheet = imported.workbook.SheetNames[0] || "";
          if (firstSheet) {
            const key = tableKey(uniqueName, firstSheet);
            setActiveTable(key);
          }
        }
      }

      rebuildTableOptions();
      rebuildDeleteOptions();
      updateLoadedFilesUI();
      const pendingKey = consumePendingImportedSelection();
      if (pendingKey) {
        setActiveTable(pendingKey);
      } else if (!state.project.activeTableKey) {
        const firstKey = sheetSelect.value;
        if (firstKey) setActiveTable(firstKey);
      }

      sheetSelect.disabled = false;
      applySettings.disabled = false;
      runSearch.disabled = false;
      runRowHeaderScan.disabled = false;

      const tableCount = listRawTableKeys().length;
      setStatus(fileStatus, `読み込み完了（テーブル数: ${tableCount}）`, "ok");
      applySettingsAndNormalize();

    } catch (err) {
      console.error(err);
      setStatus(fileStatus, "読み込み失敗（ファイル形式を確認してください）", "err");
      sheetSelect.disabled = true;
      applySettings.disabled = true;
      runSearch.disabled = true;
      runRowHeaderScan.disabled = true;
    } finally {
      fileEl.value = "";
    }
  });

  updateRowHeaderLetters();
  updateDataColLetters();

  sheetSelect.addEventListener("change", () => {
    const key = sheetSelect.value;
    if (!key) return;
    setActiveTable(key);
    applySettingsAndNormalize();
  });

  deleteTableBtn.addEventListener("click", () => {
    const key = deleteTableSelect.value;
    if (!key) return;
    deleteTableByKey(key);
  });

  deleteFileBtn.addEventListener("click", () => {
    const fileName = deleteFileSelect.value;
    if (!fileName) return;
    deleteFileByName(fileName);
  });

  applySettings.addEventListener("click", () => {
    applySettingsAndNormalize();
  });
  exportSettingsBtn.addEventListener("click", () => {
    const payload = buildSettingsSnapshot();
    downloadSettingsJson(payload);
    setStatus(settingsStatus, `設定をエクスポートしました（${Object.keys(payload.perTable).length}テーブル）`, "ok");
  });
  importSettingsBtn.addEventListener("click", () => {
    importSettingsFile.click();
  });
  importSettingsFile.addEventListener("change", async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const imported = applyImportedSettings(payload);
      const key = imported.selectedTableKey || getActiveTableKey();
      if (imported.selectedTableKey) {
        setActiveTable(imported.selectedTableKey);
      }
      if (key) {
        const settings = ensureTableSettings(key);
        applySettingsToUI(settings);
        applySettingsAndNormalize();
      } else {
        applySettingsToUI({
          ...state.settings.defaults,
          filePathMemo: imported.importedFilePathMemo || state.settings.defaults.filePathMemo || ""
        });
      }
      const selectionMessage = imported.selectedTableKey
        ? ` / 選択シート=${state.project.activeSheetName}`
        : "";
      setStatus(settingsStatus, `設定をインポートしました（${imported.importedCount}テーブル${selectionMessage}）`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(settingsStatus, "設定のインポートに失敗しました（JSON形式を確認してください）", "err");
    } finally {
      importSettingsFile.value = "";
    }
  });

  runSearch.addEventListener("click", () => {
    const table = storage.getTable(getActiveTableKey());
    if (!table) return;

    const q = queryEl.value ?? "";
    const mode = modeEl.value;
    const cs = caseEl.value === "sensitive";

    if (mode === "regex" && q.trim() === "") {
      setStatus(searchStatus, "正規表現が空です", "warn");
      return;
    }

    const t0 = performance.now();
    let result;
    try {
      result = Analyzer.searchTable(table, q, mode, cs);
    } catch (e) {
      setStatus(searchStatus, "正規表現が不正です", "err");
      return;
    }

    if (result.error === "empty") {
      setStatus(searchStatus, "検索文字が空です", "warn");
      return;
    }

    const results = result.results || [];
    const t1 = performance.now();
    setStatus(searchStatus, `完了：${results.length}件（${Math.round(t1 - t0)}ms）`, "ok");

    state.results.lastSearch = results;
    downloadResults.disabled = results.length === 0;
    renderResults(results);
  });

  runRowHeaderScan.addEventListener("click", () => {
    const table = storage.getTable(getActiveTableKey());
    if (!table) return;

    const q = rowHeaderQuery.value ?? "";
    const excludeValue = rowHeaderExcludeValue.value ?? "-";
    const mode = modeEl.value;
    const cs = caseEl.value === "sensitive";

    if (mode === "regex" && q.trim() === "") {
      setStatus(rowHeaderStatus, "正規表現が空です", "warn");
      return;
    }

    const t0 = performance.now();
    let result;
    try {
      result = Analyzer.scanRowHeaderNotDash(table, q, mode, cs, excludeValue);
    } catch (e) {
      setStatus(rowHeaderStatus, "正規表現が不正です", "err");
      return;
    }

    if (result.error === "empty") {
      setStatus(rowHeaderStatus, "行ヘッダ条件が空です", "warn");
      return;
    }

    const results = result.results || [];
    const t1 = performance.now();
    setStatus(rowHeaderStatus, `完了：${results.length}件（${Math.round(t1 - t0)}ms）`, "ok");

    state.results.lastSearch = results;
    downloadResults.disabled = results.length === 0;
    renderResults(results);
  });

  downloadResults.addEventListener("click", () => {
    ExportService.exportSearchResults(state.results.lastSearch);
  });

  function applySettingsAndNormalize() {
    const key = getActiveTableKey();
    if (!key) return;

    const settings = readSettingsFromUI();
    state.settings.perTable[key] = settings;
    updateCurrentSettingsCard(settings);

    const { fileName, sheetName } = parseTableKey(key);
    const file = state.raw.files[fileName];
    if (!file) return;
    const rawSheet = file.sheets[sheetName];
    if (!rawSheet) return;

    const result = Normalizer.normalizeTable(fileName, sheetName, rawSheet.aoa, settings);
    storage.putTable(key, result.table);

    updateSettingsStatus(result.table, result.warnings);
    metaPill.textContent = `${formatTableLabel(fileName, sheetName)} / 行=${result.table.bounds.maxRows}, 列=${result.table.bounds.maxCols}`;
    metaPill.className = "pill";
    resetResultsUI();
    renderHeaderLists(result.table);
    log(`Normalized: ${key}`);
  }

  function updateSettingsStatus(table, warnings) {
    const b = table.bounds;
    const msg = warnings.length
      ? `Settings applied: data start row ${b.drS + 1} / col ${b.dcS + 1} (warn: ${warnings.join(" / ")})`
      : `Settings applied: data start row ${b.drS + 1} / col ${b.dcS + 1}`;
    setStatus(settingsStatus, msg, warnings.length ? "warn" : "ok");
  }

  function renderResults(results) {
    const filtered = applyResultFilter(results || []);
    const sorted = applyResultSort(filtered);
    resultsBody.innerHTML = "";
    if (!sorted || sorted.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "status";
      td.textContent = "一致するデータがありません";
      tr.appendChild(td);
      resultsBody.appendChild(tr);
      return;
    }

    sorted.forEach((r, idx) => {
      const tr = document.createElement("tr");
      const cells = [
        String(idx + 1),
        r.sheet,
        String(r.row),
        String(r.col),
        r.rowHeaderText || "",
        r.colHeaderText || "",
        r.value
      ];
      cells.forEach((txt) => {
        const td = document.createElement("td");
        td.textContent = txt;
        tr.appendChild(td);
      });
      resultsBody.appendChild(tr);
    });
  }

  function applyResultFilter(results) {
    const q = (resultFilter.value || "").trim();
    if (!q) {
      resultFilterStatus.textContent = results.length ? `表示 ${results.length}` : "";
      return results;
    }
    const needle = q.toLowerCase();
    const field = resultFilterColumn.value || "all";
    const filtered = results.filter((r) => {
      if (field === "all") {
        const hay = [
          r.sheet,
          r.row,
          r.col,
          r.rowHeaderText,
          r.colHeaderText,
          r.value
        ].map(v => String(v ?? "")).join(" ").toLowerCase();
        return hay.includes(needle);
      }
      const val = String(r[field] ?? "").toLowerCase();
      return val.includes(needle);
    });
    resultFilterStatus.textContent = `表示 ${filtered.length}/${results.length}`;
    return filtered;
  }

  function applyResultSort(results) {
    const sortBy = resultGroupBy.value || "none";
    if (sortBy === "none") return results;
    const sorted = results.slice();
    sorted.sort((a, b) => {
      const av = String(a[sortBy] ?? "");
      const bv = String(b[sortBy] ?? "");
      return av.localeCompare(bv, "ja");
    });
    return sorted;
  }

  function renderHeaderLists(table) {
    const colTexts = table.columns.map((c) => c.headerText || "(空)");
    const rowTexts = table.rowHeaders.map((r) => r.headerText || "(空)");
    colHeaderList.textContent = colTexts.length ? colTexts.join(" / ") : "該当なし";
    rowHeaderList.textContent = rowTexts.length ? rowTexts.join(" / ") : "該当なし";
  }

  function buildMatcher(q, mode, cs) {
    if (mode === "regex") {
      const re = new RegExp(q, cs ? "" : "i");
      return (s) => re.test(s);
    }

    const terms = String(q)
      .split(",")
      .map(s => s.trim())
      .filter(s => s !== "");

    if (terms.length === 0) return null;

    const normalize = (s) => (cs ? s : s.toLowerCase());
    const needles = cs ? terms : terms.map(t => t.toLowerCase());

    if (mode === "contains") {
      return (s) => {
        const hay = normalize(s);
        return needles.some(t => hay.includes(t));
      };
    }

    if (mode === "equals") {
      return (s) => {
        const hay = normalize(s);
        return needles.some(t => hay === t);
      };
    }

    return () => false;
  }

  function csvEscape(s) {
    const str = cellToString(s);
    if (/[",\n]/.test(str)) return "\"" + str.replace(/\"/g, "\"\"") + "\"";
    return str;
  }

  function pad2(n){ return String(n).padStart(2,"0"); }

  // Boundaries: Importer / Normalizer / Analyzer / Storage / Export / AppCore
  // Importer: XLSX -> aoa, Normalizer: aoa -> NormalizedTable,
  // Analyzer: search on NormalizedTable, Storage: facade, Export: CSV.
})();
