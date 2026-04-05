let appState = {
  notes: [],
  filtered: [],
  activeId: null,
  generatedAt: null,
};

const els = {
  query: document.getElementById("query"),
  clearBtn: document.getElementById("clearBtn"),
  titleOnly: document.getElementById("titleOnly"),
  limit: document.getElementById("limit"),
  meta: document.getElementById("meta"),
  resultsInfo: document.getElementById("resultsInfo"),
  results: document.getElementById("results"),
  empty: document.getElementById("empty"),
  viewer: document.getElementById("viewer"),
  viewerTitle: document.getElementById("viewerTitle"),
  viewerPath: document.getElementById("viewerPath"),
  viewerMtime: document.getElementById("viewerMtime"),
  viewerTags: document.getElementById("viewerTags"),
  viewerBody: document.getElementById("viewerBody"),
  viewerAttachmentsWrap: document.getElementById("viewerAttachmentsWrap"),
  viewerAttachments: document.getElementById("viewerAttachments"),
};

init();

async function init() {
  bindEvents();
  try {
    const res = await fetch("./search-index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`search-index.json の読み込みに失敗: ${res.status}`);

    const data = await res.json();
    appState.notes = Array.isArray(data.notes) ? data.notes : [];
    appState.filtered = [...appState.notes];
    appState.generatedAt = data.generated_at || "";

    const metaText = [
      `${appState.notes.length} 件`,
      data.vault?.notes_dir ? `notes: ${data.vault.notes_dir}` : "",
      data.vault?.attachments_dir ? `attachments: ${data.vault.attachments_dir}` : "",
      appState.generatedAt ? `生成: ${formatDate(appState.generatedAt)}` : "",
    ].filter(Boolean).join(" / ");

    els.meta.textContent = metaText || "インデックスを読み込み済み";
    renderResults();
  } catch (err) {
    els.meta.textContent = "インデックスの読み込みに失敗しました";
    els.results.innerHTML = `
      <div class="result-item">
        <div class="result-title">読み込みエラー</div>
        <div class="result-snippet">${escapeHtml(err.message || String(err))}</div>
      </div>
    `;
  }
}

function bindEvents() {
  els.query.addEventListener("input", renderResults);
  els.titleOnly.addEventListener("change", renderResults);
  els.limit.addEventListener("change", renderResults);
  els.clearBtn.addEventListener("click", () => {
    els.query.value = "";
    renderResults();
    els.query.focus();
  });
  els.viewerBody.addEventListener("click", handleViewerClick);
}

function renderResults() {
  const rawQuery = els.query.value.trim();
  const query = normalize(rawQuery);
  const titleOnly = els.titleOnly.checked;
  const limit = Number(els.limit.value || 30);

  let items = appState.notes.map((note) => ({
    note,
    score: scoreNote(note, query, titleOnly),
    snippet: makeSnippet(note, query, titleOnly),
  }));

  if (query) {
    items = items.filter((item) => item.score > 0);
  }

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.note.mtime || "").localeCompare(a.note.mtime || "");
  });

  appState.filtered = items.slice(0, limit).map((item) => item.note);

  els.resultsInfo.textContent = query
    ? `「${rawQuery}」の検索結果: ${items.length} 件（表示 ${Math.min(items.length, limit)} 件）`
    : `全 ${appState.notes.length} 件（更新日時順・スコア順）`;

  els.results.innerHTML = items.slice(0, limit).map(({ note, snippet }) => {
    const activeClass = note.id === appState.activeId ? " active" : "";
    return `
      <article class="result-item${activeClass}" tabindex="0" role="button" data-note-id="${escapeAttr(note.id)}" aria-label="${escapeAttr(note.title || note.path || "ノート")}">
        <div class="result-title">${highlight(escapeHtml(note.title || "(無題)"), query)}</div>
        <div class="result-path">${escapeHtml(note.path || "")}</div>
        <div class="result-snippet">${highlight(escapeHtml(snippet), query)}</div>
      </article>
    `;
  }).join("");

  els.results.querySelectorAll("[data-note-id]").forEach((item) => {
    item.addEventListener("click", () => openNote(item.dataset.noteId));
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openNote(item.dataset.noteId);
    });
  });

  if (!appState.activeId && appState.filtered.length > 0) {
    openNote(appState.filtered[0].id);
  } else if (appState.activeId && !appState.filtered.some((item) => item.id === appState.activeId)) {
    if (appState.filtered.length > 0) openNote(appState.filtered[0].id);
    else clearViewer();
  } else {
    updateActiveItem();
  }
}

function openNote(noteId) {
  const note = appState.notes.find((item) => item.id === noteId);
  if (!note) return;

  appState.activeId = noteId;
  updateActiveItem();

  els.empty.classList.add("hidden");
  els.viewer.classList.remove("hidden");
  els.viewerTitle.textContent = note.title || "(無題)";
  els.viewerPath.textContent = note.path || "";
  els.viewerMtime.textContent = note.mtime ? `更新: ${formatDate(note.mtime)}` : "";
  els.viewerTags.innerHTML = (note.tags || [])
    .map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`)
    .join("");
  els.viewerBody.innerHTML = renderMarkdown(note.body || "");

  const attachments = Array.isArray(note.attachments) ? note.attachments : [];
  if (attachments.length > 0) {
    els.viewerAttachmentsWrap.classList.remove("hidden");
    els.viewerAttachments.innerHTML = attachments.map((att) => `
      <li>
        <a href="${escapeAttr(att.resolved || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(att.label || att.resolved || "添付ファイル")}</a>
        <span class="result-path">(${escapeHtml(att.type || "file")})</span>
      </li>
    `).join("");
  } else {
    els.viewerAttachmentsWrap.classList.add("hidden");
    els.viewerAttachments.innerHTML = "";
  }
}

function clearViewer() {
  appState.activeId = null;
  updateActiveItem();
  els.empty.classList.remove("hidden");
  els.viewer.classList.add("hidden");
}

function updateActiveItem() {
  els.results.querySelectorAll(".result-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.noteId === appState.activeId);
  });
}

function handleViewerClick(event) {
  const link = event.target.closest(".note-link");
  if (!link) return;
  event.preventDefault();
  const target = link.dataset.note;
  if (target) openNote(target);
}

function scoreNote(note, query, titleOnly) {
  if (!query) return 1;

  const title = normalize(note.title || "");
  const tags = normalize((note.tags || []).join(" "));
  const headings = normalize((note.headings || []).join(" "));
  const body = normalize(note.body || "");
  const path = normalize(note.path || "");

  let score = 0;
  if (title.includes(query)) score += 80;
  if (tags.includes(query)) score += 40;
  if (headings.includes(query)) score += 30;
  if (path.includes(query)) score += 20;
  if (!titleOnly && body.includes(query)) score += 10;

  const words = query.split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (title.includes(word)) score += 20;
    if (tags.includes(word)) score += 10;
    if (headings.includes(word)) score += 8;
    if (path.includes(word)) score += 6;
    if (!titleOnly && body.includes(word)) score += 3;
  }

  return score;
}

function makeSnippet(note, query, titleOnly) {
  if (titleOnly) return `タグ: ${(note.tags || []).join(", ")}`;

  const plain = stripMarkdown(note.body || "");
  if (!query) return plain.slice(0, 220);

  const body = normalize(plain);
  const index = body.indexOf(query);
  if (index < 0) return plain.slice(0, 220);

  const start = Math.max(0, index - 70);
  const end = Math.min(plain.length, index + query.length + 120);
  return `${start > 0 ? "..." : ""}${plain.slice(start, end).replace(/\n+/g, " ")}${end < plain.length ? "..." : ""}`;
}

function renderMarkdown(md) {
  let text = String(md || "");
  const htmlPlaceholders = [];
  text = text.replace(/<a\b[^>]*class="note-link"[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    const key = `@@HTML${htmlPlaceholders.length}@@`;
    htmlPlaceholders.push(match);
    return key;
  });

  const codeBlocks = [];
  text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const key = `@@CODE${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return key;
  });

  text = text.replace(/^(>\s?.+)$/gm, (line) => `<blockquote>${escapeHtml(line.replace(/^>\s?/, ""))}</blockquote>`);
  text = text.replace(/^###### (.*)$/gm, "<h6>$1</h6>");
  text = text.replace(/^##### (.*)$/gm, "<h5>$1</h5>");
  text = text.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
  text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  text = renderTables(text);

  text = text.replace(/(?:^|\n)([-*] .+(?:\n[-*] .+)*)/g, (match) => {
    const items = match.trim().split("\n").map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`).join("");
    return `\n<ul>${items}</ul>`;
  });
  text = text.replace(/(?:^|\n)(\d+\. .+(?:\n\d+\. .+)*)/g, (match) => {
    const items = match.trim().split("\n").map((line) => `<li>${line.replace(/^\d+\.\s+/, "")}</li>`).join("");
    return `\n<ol>${items}</ol>`;
  });

  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img alt="${escapeAttr(alt)}" src="${escapeAttr(src)}" loading="lazy" />`);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (/^<(?:(h\d|ul|ol|li|pre|blockquote|table|thead|tbody|tr|th|td|img|p))/i.test(chunk)) return chunk;
      return `<p>${chunk.replace(/\n/g, "<br>")}</p>`;
    });

  text = chunks.join("\n");
  text = text.replace(/@@CODE(\d+)@@/g, (_, i) => codeBlocks[Number(i)] || "");
  text = text.replace(/@@HTML(\d+)@@/g, (_, i) => htmlPlaceholders[Number(i)] || "");
  return text;
}

function renderTables(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitTableRow(lines[i++]));
      const thead = `<thead><tr>${headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows.map((row) => `<tr>${row.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
    } else {
      out.push(lines[i++]);
    }
  }

  return out.join("\n");
}

function isTableRow(line) {
  return /^\|(.+)\|$/.test(line.trim());
}

function isTableSeparator(line) {
  return /^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(line.trim());
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
}

function stripMarkdown(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, " $1 ")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, " $1 ")
    .replace(/[#>*`_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(str) {
  return String(str || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function highlight(text, query) {
  if (!query) return text;

  const words = Array.from(new Set(normalize(query).split(/\s+/).filter(Boolean)))
    .sort((a, b) => b.length - a.length);

  let out = text;
  for (const word of words) {
    out = out.replace(new RegExp(`(${escapeRegExp(word)})`, "gi"), "<mark>$1</mark>");
  }
  return out;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, "&#96;");
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
