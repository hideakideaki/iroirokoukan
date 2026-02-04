/* 用語集 UI（terms.json 読み込み）
 * - 検索（スペース区切りAND）
 * - フィルタ（category/tag/status/★のみ）
 * - ソート（関連度/更新日/用語名）
 * - 2ペイン（一覧/詳細）
 * - お気に入り・履歴（localStorage）
 * - URL状態（?q=...&id=...&cat=...）
 * - キーボード操作（/, Esc, ↑↓, Enter）
 */

const DATA_URL = "data/terms.json";

const LS_KEYS = {
  favorites: "glossary_favorite_ids_v1",
  recent: "glossary_recent_ids_v1",
  ui: "glossary_ui_state_v1",
};

const els = {
  metaInfo: document.getElementById("metaInfo"),
  q: document.getElementById("q"),
  clearQ: document.getElementById("clearQ"),
  category: document.getElementById("category"),
  tag: document.getElementById("tag"),
  status: document.getElementById("status"),
  sort: document.getElementById("sort"),
  onlyFav: document.getElementById("onlyFav"),
  list: document.getElementById("list"),
  listFooter: document.getElementById("listFooter"),
  detail: document.getElementById("detail"),
  toggleFav: document.getElementById("toggleFav"),
  copyLink: document.getElementById("copyLink"),
  showRecent: document.getElementById("showRecent"),
  helpDialog: document.getElementById("helpDialog"),
  openHelp: document.getElementById("openHelp"),
  closeHelp: document.getElementById("closeHelp"),
};

let TERMS = [];
let TERMS_BY_ID = new Map();

let state = {
  q: "",
  category: "",
  tag: "",
  status: "",
  sort: "relevance",
  onlyFav: false,
  selectedId: "",
  listMode: "search", // "search" | "recent"
  activeIndex: -1,    // list selection index (in current view)
};

let favorites = new Set();
let recent = []; // array of ids

// ---------- utilities ----------
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function safeStr(v) {
  return (v == null) ? "" : String(v);
}

function norm(s) {
  // 軽量正規化：大小・前後空白・全角空白を軽く吸収
  return safeStr(s)
    .replace(/\u3000/g, " ")
    .toLowerCase()
    .trim();
}

function splitTokens(q) {
  const n = norm(q);
  if (!n) return [];
  return n.split(/\s+/).filter(Boolean);
}

function parseYmd(s) {
  // YYYY-MM-DD -> number for compare
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safeStr(s).trim());
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

function escapeHtml(s) {
  return safeStr(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlight(text, tokens) {
  const raw = safeStr(text);
  if (!raw || !tokens.length) return escapeHtml(raw);

  // 長文の過剰ハイライトは避けるため、summary/term中心で使う前提
  let out = escapeHtml(raw);
  // tokensの短い順にやると部分が壊れやすいので長い順
  const uniq = Array.from(new Set(tokens)).sort((a, b) => b.length - a.length);

  for (const t of uniq) {
    if (t.length < 2) continue;
    const re = new RegExp(escapeRegExp(t), "ig");
    out = out.replace(re, (m) => `<mark>${escapeHtml(m)}</mark>`);
  }
  return out;
}

function escapeRegExp(s) {
  return safeStr(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadJsonLS(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return fallback;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function saveJsonLS(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function updateUrlFromState() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.category) p.set("cat", state.category);
  if (state.tag) p.set("tag", state.tag);
  if (state.status) p.set("st", state.status);
  if (state.sort && state.sort !== "relevance") p.set("sort", state.sort);
  if (state.onlyFav) p.set("fav", "1");
  if (state.selectedId) p.set("id", state.selectedId);
  if (state.listMode === "recent") p.set("mode", "recent");

  const newUrl = `${location.pathname}?${p.toString()}`;
  history.replaceState(null, "", newUrl);
}

function applyUrlToState() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") ?? "";
  state.category = p.get("cat") ?? "";
  state.tag = p.get("tag") ?? "";
  state.status = p.get("st") ?? "";
  state.sort = p.get("sort") ?? "relevance";
  state.onlyFav = p.get("fav") === "1";
  state.selectedId = p.get("id") ?? "";
  state.listMode = (p.get("mode") === "recent") ? "recent" : "search";
}

// ---------- scoring / filtering ----------
function getSearchText(t) {
  // 検索対象をまとめる（コスト軽減のためキャッシュしても良いが1000件なら不要）
  const parts = [
    t.term, t.reading, t.en, t.summary, t.body,
    ...(t.tags || []), ...(t.category || []), ...(t.source || []),
    t.status, t.id,
  ];
  return norm(parts.filter(Boolean).join(" "));
}

function computeRelevance(t, tokens) {
  if (!tokens.length) return 0;

  const termN = norm(t.term);
  const readingN = norm(t.reading);
  const enN = norm(t.en);
  const summaryN = norm(t.summary);
  const bodyN = norm(t.body);
  const tagsN = norm((t.tags || []).join(" "));
  const catN = norm((t.category || []).join(" "));
  const sourceN = norm((t.source || []).join(" "));

  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;

    if (termN.startsWith(tok)) score += 100;
    else if (termN.includes(tok)) score += 60;

    if (readingN.includes(tok)) score += 40;
    if (enN.includes(tok)) score += 40;

    if (tagsN.includes(tok)) score += 30;
    if (catN.includes(tok)) score += 30;
    if (sourceN.includes(tok)) score += 12;

    if (summaryN.includes(tok)) score += 20;
    if (bodyN.includes(tok)) score += 10;
  }
  return score;
}

function matchesAllTokens(t, tokens) {
  if (!tokens.length) return true;
  const hay = getSearchText(t);
  return tokens.every(tok => hay.includes(tok));
}

function filterTerms() {
  const tokens = splitTokens(state.q);

  let arr = TERMS;

  if (state.listMode === "recent") {
    // recent順に表示
    arr = recent.map(id => TERMS_BY_ID.get(id)).filter(Boolean);
  }

  // favorites filter
  if (state.onlyFav) {
    arr = arr.filter(t => favorites.has(t.id));
  }

  // category/tag/status filters
  if (state.category) {
    arr = arr.filter(t => (t.category || []).includes(state.category));
  }
  if (state.tag) {
    arr = arr.filter(t => (t.tags || []).includes(state.tag));
  }
  if (state.status) {
    arr = arr.filter(t => safeStr(t.status) === state.status);
  }

  // query filter
  if (tokens.length) {
    arr = arr.filter(t => matchesAllTokens(t, tokens));
  }

  // sort
  if (state.sort === "updated_desc") {
    arr = [...arr].sort((a, b) => parseYmd(b.updated) - parseYmd(a.updated));
  } else if (state.sort === "term_asc") {
    arr = [...arr].sort((a, b) => safeStr(a.term).localeCompare(safeStr(b.term), "ja"));
  } else {
    // relevance
    if (tokens.length) {
      arr = [...arr].sort((a, b) => computeRelevance(b, tokens) - computeRelevance(a, tokens));
    } else {
      // クエリ無しのときは更新日降順が実務的に便利
      arr = [...arr].sort((a, b) => parseYmd(b.updated) - parseYmd(a.updated));
    }
  }

  return { arr, tokens };
}

// ---------- UI rendering ----------
function renderList() {
  const { arr, tokens } = filterTerms();

  // activeIndex調整
  if (arr.length === 0) state.activeIndex = -1;
  else if (state.activeIndex < 0) state.activeIndex = 0;
  else if (state.activeIndex >= arr.length) state.activeIndex = arr.length - 1;

  els.list.innerHTML = "";
  const frag = document.createDocumentFragment();

  arr.forEach((t, idx) => {
    const div = document.createElement("div");
    div.className = "list-item" + (t.id === state.selectedId ? " active" : "");
    div.dataset.id = t.id;

    const fav = favorites.has(t.id) ? "★" : "";
    const status = safeStr(t.status || "draft");

    const badges = [];
    badges.push(`<span class="badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>`);
    if (fav) badges.push(`<span class="badge">${fav}</span>`);

    const catChips = (t.category || []).slice(0, 3).map(x => `<span class="chip">${escapeHtml(x)}</span>`).join("");
    const tagChips = (t.tags || []).slice(0, 3).map(x => `<span class="chip">${escapeHtml(x)}</span>`).join("");

    div.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-term">${highlight(t.term, tokens)}</div>
          <div class="item-summary">${highlight(t.summary || "", tokens) || ""}</div>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>
      <div class="chips">
        ${catChips}
        ${tagChips}
      </div>
    `;

    div.addEventListener("click", () => {
      state.activeIndex = idx;
      openDetail(t.id, { pushRecent: true, focus: false });
    });

    frag.appendChild(div);
  });

  els.list.appendChild(frag);

  // footer
  const modeLabel = (state.listMode === "recent") ? "履歴" : "検索";
  els.listFooter.textContent = `${modeLabel}：${arr.length}件 / 全${TERMS.length}件`;

  // selection highlight in list (activeIndex not necessarily selectedId)
  // "active" class is used for selectedId; activeIndex is keyboard cursor.
  // We'll add a subtle outline via attribute if needed, but keep simple: selectedId is highlight.

  // auto open first item when none selected and list has entries
  if (!state.selectedId && arr.length) {
    openDetail(arr[0].id, { pushRecent: false, focus: false, fromAuto: true });
  } else if (state.selectedId && !TERMS_BY_ID.get(state.selectedId)) {
    // invalid id
    state.selectedId = "";
    renderDetail(null);
  }

  return arr;
}

function renderDetail(t) {
  if (!t) {
    els.detail.classList.add("empty");
    els.detail.innerHTML = `
      <div class="empty-title">左の一覧から用語を選択</div>
      <div class="empty-subtitle">/ キーで検索にフォーカス、↑↓で選択、Enterで決定</div>
    `;
    els.toggleFav.disabled = true;
    els.copyLink.disabled = true;
    return;
  }

  els.detail.classList.remove("empty");

  const status = safeStr(t.status || "draft");
  const fav = favorites.has(t.id);
  els.toggleFav.disabled = false;
  els.copyLink.disabled = false;
  els.toggleFav.textContent = fav ? "★（解除）" : "★（登録）";

  const updated = safeStr(t.updated);
  const created = safeStr(t.created);

  const cat = (t.category || []).map(x => `<span class="chip">${escapeHtml(x)}</span>`).join("");
  const tags = (t.tags || []).map(x => `<span class="chip">${escapeHtml(x)}</span>`).join("");

  const related = (t.related || [])
    .map(id => {
      const rt = TERMS_BY_ID.get(id);
      const label = rt ? `${rt.term}` : id;
      return `<button class="related-btn" data-related="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  const sources = (t.source || []).map(s => {
    const ss = safeStr(s);
    if (/^https?:\/\//i.test(ss)) {
      return `<a class="a" href="${escapeHtml(ss)}" target="_blank" rel="noreferrer">${escapeHtml(ss)}</a>`;
    }
    return `<span class="kbd">${escapeHtml(ss)}</span>`;
  }).join(" ");

  els.detail.innerHTML = `
    <div class="h1">
      <div class="term">${escapeHtml(t.term)}</div>
      ${t.reading ? `<div class="reading">${escapeHtml(t.reading)}</div>` : ``}
      ${t.en ? `<div class="en">${escapeHtml(t.en)}</div>` : ``}
    </div>

    <div class="meta-row">
      <span class="badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>
      <span class="mono">ID: ${escapeHtml(t.id)}</span>
      ${updated ? `<span>更新: <span class="mono">${escapeHtml(updated)}</span></span>` : `<span>更新: —</span>`}
      ${created ? `<span>作成: <span class="mono">${escapeHtml(created)}</span></span>` : ``}
    </div>

    ${t.summary ? `
      <div class="section">
        <div class="section-title">一言定義</div>
        <div class="summary">${escapeHtml(t.summary)}</div>
      </div>` : ``}

    ${t.body ? `
      <div class="section">
        <div class="section-title">詳細</div>
        <div class="body">${escapeHtml(t.body)}</div>
      </div>` : ``}

    <div class="section">
      <div class="section-title">分類 / タグ</div>
      <div class="chips">${cat}${tags}</div>
    </div>

    ${related ? `
      <div class="section">
        <div class="section-title">関連用語</div>
        <div class="related">${related}</div>
      </div>` : ``}

    ${sources ? `
      <div class="section">
        <div class="section-title">出典</div>
        <div class="links">${sources}</div>
      </div>` : ``}
  `;

  // related click
  els.detail.querySelectorAll("[data-related]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-related");
      if (!id) return;
      openDetail(id, { pushRecent: true, focus: false });
      // list側も該当が見えるように（検索条件次第では見えないが許容）
    });
  });
}

// ---------- interactions ----------
function openDetail(id, opts = {}) {
  const t = TERMS_BY_ID.get(id);
  if (!t) return;

  state.selectedId = id;

  if (opts.pushRecent) {
    pushRecent(id);
  }

  renderDetail(t);
  renderListSelectionToSelected(); // selected highlight
  syncFavButtons();
  updateUrlFromState();
  persistUiState();

  if (opts.focus) {
    // no-op currently
  }
}

function renderListSelectionToSelected() {
  // selectedIdを active クラスに反映するため、再描画せずDOM走査で対応
  // ただし件数1000なら再描画でも問題ないが、ここは軽く。
  const nodes = els.list.querySelectorAll(".list-item");
  nodes.forEach(n => {
    n.classList.toggle("active", n.dataset.id === state.selectedId);
  });
}

function syncFavButtons() {
  if (!state.selectedId) {
    els.toggleFav.disabled = true;
    els.copyLink.disabled = true;
    els.toggleFav.textContent = "★";
    return;
  }
  els.toggleFav.disabled = false;
  els.copyLink.disabled = false;
  els.toggleFav.textContent = favorites.has(state.selectedId) ? "★（解除）" : "★（登録）";
}

function toggleFavorite(id) {
  if (!id) return;
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveJsonLS(LS_KEYS.favorites, Array.from(favorites));
  syncFavButtons();
  renderList(); // ★バッジ更新
}

function pushRecent(id) {
  recent = recent.filter(x => x !== id);
  recent.unshift(id);
  if (recent.length > 50) recent = recent.slice(0, 50);
  saveJsonLS(LS_KEYS.recent, recent);
}

function persistUiState() {
  const ui = {
    q: state.q,
    category: state.category,
    tag: state.tag,
    status: state.status,
    sort: state.sort,
    onlyFav: state.onlyFav,
    selectedId: state.selectedId,
    listMode: state.listMode,
  };
  saveJsonLS(LS_KEYS.ui, ui);
}

function loadUiStateFallback() {
  const ui = loadJsonLS(LS_KEYS.ui, null);
  if (!ui) return;
  // URLがある場合はURL優先なので、ここは「空の項目だけ」補完
  if (!state.q) state.q = safeStr(ui.q);
  if (!state.category) state.category = safeStr(ui.category);
  if (!state.tag) state.tag = safeStr(ui.tag);
  if (!state.status) state.status = safeStr(ui.status);
  if (!location.search.includes("sort=") && ui.sort) state.sort = safeStr(ui.sort);
  if (!location.search.includes("fav=")) state.onlyFav = !!ui.onlyFav;
  if (!state.selectedId) state.selectedId = safeStr(ui.selectedId);
  if (!location.search.includes("mode=") && ui.listMode) state.listMode = safeStr(ui.listMode);
}

// ---------- controls wiring ----------
const onChangeFilters = debounce(() => {
  state.q = els.q.value;
  state.category = els.category.value;
  state.tag = els.tag.value;
  state.status = els.status.value;
  state.sort = els.sort.value;
  state.onlyFav = els.onlyFav.checked;

  state.listMode = "search"; // 操作したら通常検索に戻す
  state.activeIndex = 0;

  updateUrlFromState();
  persistUiState();

  const arr = renderList();
  // 選択中がフィルタで消えた場合は先頭を開く
  if (state.selectedId) {
    const still = arr.some(x => x.id === state.selectedId);
    if (!still && arr.length) {
      openDetail(arr[0].id, { pushRecent: false });
    } else if (!still && !arr.length) {
      state.selectedId = "";
      renderDetail(null);
      updateUrlFromState();
      persistUiState();
    }
  } else {
    if (arr.length) openDetail(arr[0].id, { pushRecent: false });
  }
}, 200);

function wireControls() {
  els.q.addEventListener("input", onChangeFilters);

  els.clearQ.addEventListener("click", () => {
    els.q.value = "";
    state.q = "";
    onChangeFilters();
    els.q.focus();
  });

  els.category.addEventListener("change", onChangeFilters);
  els.tag.addEventListener("change", onChangeFilters);
  els.status.addEventListener("change", onChangeFilters);
  els.sort.addEventListener("change", onChangeFilters);
  els.onlyFav.addEventListener("change", onChangeFilters);

  els.toggleFav.addEventListener("click", () => toggleFavorite(state.selectedId));

  els.copyLink.addEventListener("click", async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      flashMeta("リンクをコピーしました");
    } catch {
      flashMeta("コピーできませんでした（ブラウザ権限）");
    }
  });

  els.showRecent.addEventListener("click", () => {
    state.listMode = (state.listMode === "recent") ? "search" : "recent";
    state.activeIndex = 0;
    updateUrlFromState();
    persistUiState();
    const arr = renderList();
    if (arr.length) openDetail(arr[0].id, { pushRecent: false });
    else {
      state.selectedId = "";
      renderDetail(null);
    }
  });

  els.openHelp.addEventListener("click", () => {
    els.helpDialog.showModal();
  });
  els.closeHelp.addEventListener("click", () => {
    els.helpDialog.close();
  });
  els.helpDialog.addEventListener("click", (e) => {
    // 背景クリックで閉じる
    if (e.target === els.helpDialog) els.helpDialog.close();
  });

  // keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // dialog open: Esc close
    if (els.helpDialog.open) {
      if (e.key === "Escape") els.helpDialog.close();
      return;
    }

    if (e.key === "/") {
      // input中でなければ検索へ
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (!typing) {
        e.preventDefault();
        els.q.focus();
        els.q.select();
      }
      return;
    }

    if (e.key === "Escape") {
      // 検索クリア
      if (els.q.value) {
        els.q.value = "";
        state.q = "";
        onChangeFilters();
      }
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (typing) return;

      const { arr } = filterTerms();
      if (!arr.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.activeIndex = Math.min(arr.length - 1, state.activeIndex + 1);
        openDetail(arr[state.activeIndex].id, { pushRecent: true, focus: false });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.activeIndex = Math.max(0, state.activeIndex - 1);
        openDetail(arr[state.activeIndex].id, { pushRecent: true, focus: false });
      } else if (e.key === "Enter") {
        e.preventDefault();
        openDetail(arr[state.activeIndex].id, { pushRecent: true, focus: false });
      }
    }
  });
}

function flashMeta(msg) {
  const prev = els.metaInfo.textContent;
  els.metaInfo.textContent = msg;
  setTimeout(() => {
    els.metaInfo.textContent = prev;
  }, 1200);
}

// ---------- init ----------
function buildOptions() {
  const cats = new Set();
  const tags = new Set();

  TERMS.forEach(t => {
    (t.category || []).forEach(x => cats.add(x));
    (t.tags || []).forEach(x => tags.add(x));
  });

  const catArr = Array.from(cats).sort((a, b) => a.localeCompare(b, "ja"));
  const tagArr = Array.from(tags).sort((a, b) => a.localeCompare(b, "ja"));

  // reset (keep first option)
  els.category.innerHTML = `<option value="">分類：すべて</option>` + catArr.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  els.tag.innerHTML = `<option value="">タグ：すべて</option>` + tagArr.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
}

function applyStateToControls() {
  els.q.value = state.q;
  els.category.value = state.category;
  els.tag.value = state.tag;
  els.status.value = state.status;
  els.sort.value = state.sort;
  els.onlyFav.checked = state.onlyFav;
}

async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${DATA_URL}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("terms.json must be an array");

  // normalize each entry (defensive)
  TERMS = data.map(x => ({
    id: safeStr(x.id).trim(),
    term: safeStr(x.term).trim(),
    reading: safeStr(x.reading).trim(),
    en: safeStr(x.en).trim(),
    category: Array.isArray(x.category) ? x.category.map(safeStr).map(s => s.trim()).filter(Boolean) : [],
    tags: Array.isArray(x.tags) ? x.tags.map(safeStr).map(s => s.trim()).filter(Boolean) : [],
    summary: safeStr(x.summary),
    body: safeStr(x.body),
    related: Array.isArray(x.related) ? x.related.map(safeStr).map(s => s.trim()).filter(Boolean) : [],
    source: Array.isArray(x.source) ? x.source.map(safeStr).map(s => s.trim()).filter(Boolean) : [],
    owner: safeStr(x.owner).trim(),
    status: safeStr(x.status).trim() || "draft",
    updated: safeStr(x.updated).trim(),
    created: safeStr(x.created).trim(),
  })).filter(t => t.id && t.term);

  TERMS_BY_ID = new Map(TERMS.map(t => [t.id, t]));

  els.metaInfo.textContent = `全${TERMS.length}件`;
}

function initStorage() {
  const favArr = loadJsonLS(LS_KEYS.favorites, []);
  favorites = new Set(Array.isArray(favArr) ? favArr : []);

  const recArr = loadJsonLS(LS_KEYS.recent, []);
  recent = Array.isArray(recArr) ? recArr : [];
  // 存在しないIDを除去（データ更新対応）
  recent = recent.filter(id => TERMS_BY_ID.has(id));
  if (recent.length) saveJsonLS(LS_KEYS.recent, recent);
}

function initSelectedFromState() {
  // state.selectedId があれば開く。なければ一覧先頭。
  const arr = renderList();
  if (state.selectedId && TERMS_BY_ID.has(state.selectedId)) {
    openDetail(state.selectedId, { pushRecent: false });
    // activeIndexも同期
    const idx = arr.findIndex(x => x.id === state.selectedId);
    state.activeIndex = (idx >= 0) ? idx : 0;
  } else if (arr.length) {
    openDetail(arr[0].id, { pushRecent: false });
    state.activeIndex = 0;
  } else {
    renderDetail(null);
  }
}

(async function main() {
  try {
    applyUrlToState();
    loadUiStateFallback();

    await loadData();
    buildOptions();

    // storage uses TERMS_BY_ID, so after load
    initStorage();

    applyStateToControls();
    wireControls();

    initSelectedFromState();
    updateUrlFromState();
    persistUiState();
  } catch (e) {
    console.error(e);
    els.metaInfo.textContent = "読み込み失敗";
    els.listFooter.textContent = "data/terms.json が読めません。ローカルで開く場合は簡易サーバを使ってください。";
    els.detail.classList.add("empty");
    els.detail.innerHTML = `
      <div class="empty-title">data/terms.json の読み込みに失敗</div>
      <div class="empty-subtitle">コンソールを確認してください</div>
    `;
  }
})();
