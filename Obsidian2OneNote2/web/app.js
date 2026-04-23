const markdownInput = document.getElementById("markdownInput");
const preview = document.getElementById("preview");
const fileInput = document.getElementById("fileInput");
const copyButton = document.getElementById("copyButton");
const copyPlainButton = document.getElementById("copyPlainButton");
const clearButton = document.getElementById("clearButton");
const selectVaultButton = document.getElementById("selectVaultButton");
const openVaultNoteButton = document.getElementById("openVaultNoteButton");
const joinLinesCheckbox = document.getElementById("joinLinesCheckbox");
const statusMessage = document.getElementById("statusMessage");
const vaultLabel = document.getElementById("vaultLabel");
const noteLabel = document.getElementById("noteLabel");
const noteSearchModal = document.getElementById("noteSearchModal");
const noteSearchInput = document.getElementById("noteSearchInput");
const noteSearchResults = document.getElementById("noteSearchResults");
const noteSearchMeta = document.getElementById("noteSearchMeta");
const closeNoteSearchButton = document.getElementById("closeNoteSearchButton");

const SAMPLE = `# OneNote handoff note

This tool keeps the Obsidian preview visible while preparing a richer paste for OneNote.

## Rules

- Keep paragraphs
- Join soft-wrapped lines inside a paragraph
- Preserve **bold**, *italic*, and \`inline code\`
- Resolve image embeds when a vault is selected

> [!note] Image support
> Use "Select Vault", then "Open Vault Note" to resolve ![[attachments/picture.png]] and other local embeds.

- [ ] Review the preview
- [x] Copy to OneNote
`;

const state = {
  renderToken: 0,
  vaultRoot: null,
  currentNotePath: null,
  currentNoteName: null,
  vaultAccessMode: null,
  vaultHandle: null,
  vaultEntries: [],
  vaultPathMap: new Map(),
  vaultNameMap: new Map(),
  objectUrlMap: new Map(),
};

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: false,
  mangle: false,
});

markdownInput.value = SAMPLE;
render();
refreshVaultStatus();

markdownInput.addEventListener("input", debounce(() => {
  if (!state.currentNotePath) {
    state.currentNoteName = null;
    syncLabels();
  }
  render();
}, 120));
joinLinesCheckbox.addEventListener("change", () => render());
fileInput.addEventListener("change", handleFileOpen);
copyButton.addEventListener("click", copyForOneNote);
copyPlainButton.addEventListener("click", copyPlainText);
clearButton.addEventListener("click", () => {
  markdownInput.value = "";
  state.currentNotePath = null;
  state.currentNoteName = null;
  syncLabels();
  render();
  setStatus("Cleared.");
});
selectVaultButton.addEventListener("click", selectVault);
openVaultNoteButton.addEventListener("click", openVaultNote);
closeNoteSearchButton.addEventListener("click", closeNoteSearchModalDialog);
noteSearchInput.addEventListener("input", debounce(renderNoteSearchResults, 80));
noteSearchInput.addEventListener("keydown", async (event) => {
  if (event.key === "Escape") {
    closeNoteSearchModalDialog();
    return;
  }
  if (event.key === "Enter") {
    const [first] = getFilteredNoteEntries(noteSearchInput.value);
    if (first) {
      await loadBrowserVaultNote(first);
      closeNoteSearchModalDialog();
    }
  }
});
noteSearchModal.addEventListener("click", (event) => {
  if (event.target === noteSearchModal) {
    closeNoteSearchModalDialog();
  }
});

async function refreshVaultStatus() {
  try {
    const response = await fetch("/api/vault/status");
    const payload = await response.json();
    state.vaultRoot = payload.root || null;
    state.vaultAccessMode = payload.root ? "server" : state.vaultAccessMode;
    syncLabels();
  } catch (error) {
    console.error(error);
    setStatus("Could not read vault status.");
  }
}

async function selectVault() {
  if (typeof window.showDirectoryPicker === "function") {
    await selectVaultWithBrowserPicker();
    return;
  }

  const current = state.vaultRoot || "";
  const selected = window.prompt("Enter the Obsidian vault path.", current);
  if (selected === null) {
    setStatus("Vault selection cancelled.");
    return;
  }
  if (!selected.trim()) {
    setStatus("Vault path is required.");
    return;
  }

  setStatus("Indexing vault...");
  try {
    const response = await fetch("/api/vault/set-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selected.trim() }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.selected) {
      setStatus(payload.error || "Vault selection failed.");
      return;
    }
    state.vaultRoot = payload.root;
    state.vaultAccessMode = "server";
    state.vaultHandle = null;
    state.vaultEntries = [];
    state.vaultPathMap = new Map();
    state.vaultNameMap = new Map();
    syncLabels();
    setStatus(`Vault indexed: ${payload.file_count} files`);
    render();
  } catch (error) {
    console.error(error);
    setStatus("Vault selection failed.");
  }
}

async function selectVaultWithBrowserPicker() {
  setStatus("Waiting for vault selection...");
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    setStatus("Indexing vault...");
    const entries = await indexBrowserVault(handle);
    resetObjectUrlCache();
    state.vaultHandle = handle;
    state.vaultEntries = entries;
    state.vaultPathMap = buildVaultPathMap(entries);
    state.vaultNameMap = buildVaultNameMap(entries);
    state.vaultRoot = handle.name;
    state.vaultAccessMode = "browser";
    syncLabels();
    setStatus(`Vault indexed: ${entries.length} files`);
    render();
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("Vault selection cancelled.");
      return;
    }
    console.error(error);
    setStatus("Vault selection failed.");
  }
}

async function openVaultNote() {
  if (state.vaultAccessMode === "browser" && state.vaultEntries.length) {
    openNoteSearchModalDialog();
    return;
  }

  if (!state.vaultRoot) {
    setStatus("Select a vault first.");
    return;
  }

  const current = state.currentNotePath || "";
  const selected = window.prompt(
    "Enter the note path relative to the selected vault.",
    current
  );
  if (selected === null) {
    setStatus("Note selection cancelled.");
    return;
  }
  if (!selected.trim()) {
    setStatus("Note path is required.");
    return;
  }

  setStatus("Loading note...");
  try {
    const response = await fetch("/api/note/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selected.trim() }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.selected) {
      setStatus(payload.error || "Could not open the note.");
      return;
    }
    markdownInput.value = payload.text;
    state.currentNotePath = payload.path || null;
    state.currentNoteName = payload.name || null;
    syncLabels();
    setStatus(`Opened ${payload.name}`);
    render();
  } catch (error) {
    console.error(error);
    setStatus("Could not open the note.");
  }
}

function openNoteSearchModalDialog() {
  noteSearchModal.classList.remove("hidden");
  noteSearchModal.setAttribute("aria-hidden", "false");
  noteSearchInput.value = state.currentNotePath || state.currentNoteName || "";
  renderNoteSearchResults();
  window.setTimeout(() => noteSearchInput.focus(), 0);
}

function closeNoteSearchModalDialog() {
  noteSearchModal.classList.add("hidden");
  noteSearchModal.setAttribute("aria-hidden", "true");
}

function renderNoteSearchResults() {
  const matches = getFilteredNoteEntries(noteSearchInput.value);
  noteSearchMeta.textContent = `${matches.length} note(s)`;
  noteSearchResults.innerHTML = "";

  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "modal-meta";
    empty.textContent = "No notes matched the current query.";
    noteSearchResults.appendChild(empty);
    return;
  }

  matches.slice(0, 100).forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-result";
    button.innerHTML = `<strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.path)}</span>`;
    button.addEventListener("click", async () => {
      await loadBrowserVaultNote(entry);
      closeNoteSearchModalDialog();
    });
    noteSearchResults.appendChild(button);
  });
}

function getFilteredNoteEntries(query) {
  const source = state.vaultEntries.filter((entry) => isMarkdownPath(entry.path));
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...source].sort((a, b) => a.path.localeCompare(b.path));
  }

  const pathMatches = source.filter((entry) => entry.path.toLowerCase().includes(normalized));
  const nameFirst = pathMatches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(normalized) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(normalized) ? 0 : 1;
    if (aStarts !== bStarts) {
      return aStarts - bStarts;
    }
    return a.path.localeCompare(b.path);
  });
  return nameFirst;
}

async function loadBrowserVaultNote(entry) {
  try {
    const file = await entry.handle.getFile();
    markdownInput.value = await file.text();
    state.currentNotePath = entry.path;
    state.currentNoteName = entry.name;
    syncLabels();
    render();
    setStatus(`Opened ${entry.path}`);
  } catch (error) {
    console.error(error);
    setStatus("Could not open the note.");
  }
}

async function handleFileOpen(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  const text = await file.text();
  markdownInput.value = text;
  state.currentNotePath = await promptForNotePath(file.name);
  state.currentNoteName = file.name;
  syncLabels();
  render();
  setStatus(`Loaded ${file.name}`);
}

async function render() {
  const token = ++state.renderToken;
  await renderMarkdownInto(preview, {
    joinSoftLines: false,
    breaks: true,
    token,
    ignoreTokenMismatch: false,
  });

  if (!preview.innerHTML.trim()) {
    preview.innerHTML = '<p class="placeholder">Preview is empty.</p>';
    return;
  }
}

function normalizeMarkdown(source, options) {
  let text = source.replace(/\r\n?/g, "\n");
  text = stripObsidianComments(text);
  text = removeBlockIds(text);
  text = convertCallouts(text);
  text = convertEmbeds(text);
  text = convertWikiLinks(text);
  text = convertHighlights(text);

  if (options.joinSoftLines) {
    text = joinSoftWrappedLines(text);
  }

  return text.trim();
}

async function promptForNotePath(defaultName) {
  if (!state.vaultRoot) {
    return null;
  }

  const suggested = state.currentNotePath || defaultName || "";
  const selected = window.prompt(
    "Optional: enter the note path relative to the selected vault for relative image resolution.",
    suggested
  );
  if (selected === null) {
    return null;
  }
  const normalized = selected.trim().replaceAll("\\", "/");
  return normalized || null;
}

function stripObsidianComments(text) {
  return text.replace(/%%[\s\S]*?%%/g, "");
}

function removeBlockIds(text) {
  return text
    .replace(/(^|\n)\^[-a-zA-Z0-9]+(?=\n|$)/g, "$1")
    .replace(/\s+\^[-a-zA-Z0-9]+(?=\n|$)/g, "");
}

function convertCallouts(text) {
  const lines = text.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i].match(/^>\s*\[!([a-zA-Z0-9_-]+)\][+-]?\s*(.*)$/);
    if (!first) {
      out.push(lines[i]);
      continue;
    }

    const type = capitalize(first[1].replace(/[-_]/g, " "));
    const title = first[2].trim();
    const bodyLines = [];

    i += 1;
    while (i < lines.length && /^> ?/.test(lines[i])) {
      bodyLines.push(lines[i].replace(/^> ?/, ""));
      i += 1;
    }
    i -= 1;

    const header = title ? `> **${type}: ${title}**` : `> **${type}**`;
    out.push(header);
    bodyLines.forEach((line) => out.push(`> ${line}`));
  }

  return out.join("\n");
}

function convertEmbeds(text) {
  return text.replace(/!\[\[([^\]]+)\]\]/g, (_, content) => {
    const [targetPart, aliasPart] = content.split("|");
    const target = targetPart.trim();
    const label = (aliasPart || getDisplayText(target)).trim();
    const escapedTarget = escapeHtml(target);
    const escapedLabel = escapeHtml(label);
    return `\n<div class="embed-placeholder" data-embed-target="${escapedTarget}" data-embed-label="${escapedLabel}">Resolving embed: ${escapedLabel}</div>\n`;
  });
}

function convertWikiLinks(text) {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, content) => {
    const [targetPart, aliasPart] = content.split("|");
    const label = (aliasPart || getDisplayText(targetPart)).trim();
    return `<span class="internal-link">${escapeHtml(label)}</span>`;
  });
}

function convertHighlights(text) {
  return text.replace(/==(.+?)==/g, "<mark>$1</mark>");
}

function getDisplayText(target) {
  const withoutHeading = target.split("#")[0];
  const segments = withoutHeading.split("/");
  return (segments[segments.length - 1] || withoutHeading).trim();
}

function joinSoftWrappedLines(text) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence || shouldKeepOwnLine(line)) {
      out.push(line);
      continue;
    }

    const previous = out[out.length - 1];
    if (!previous || !previous.trim() || shouldKeepOwnLine(previous)) {
      out.push(line);
      continue;
    }

    out[out.length - 1] = `${previous.trimEnd()} ${trimmed}`;
  }

  return out.join("\n");
}

function shouldKeepOwnLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  return [
    /^#{1,6}\s/,
    /^[-*+]\s/,
    /^\d+\.\s/,
    /^>\s?/,
    /^\|/,
    /^-{3,}$/,
    /^\*{3,}$/,
    /^```/,
    /^~~~/,
    /^ {4,}/,
    /^<div\b/i,
    /^<\/div>/i,
  ].some((pattern) => pattern.test(trimmed));
}

async function resolveEmbedPlaceholders(token) {
  await resolveEmbedPlaceholdersIn(preview, token);
}

async function resolveEmbedPlaceholdersIn(root, token) {
  const placeholders = [...root.querySelectorAll(".embed-placeholder[data-embed-target]")];
  for (const placeholder of placeholders) {
    if (token !== null && token !== state.renderToken) {
      return;
    }
    const target = placeholder.dataset.embedTarget;
    const label = placeholder.dataset.embedLabel || getDisplayText(target);
    const resolved = await resolveVaultTarget(target);
    if (!resolved?.found) {
      placeholder.textContent = `Missing embed: ${label}`;
      continue;
    }
    if (resolved.is_image) {
      placeholder.replaceWith(buildImageFigure(resolved.url, label, target));
      continue;
    }
    placeholder.textContent = `Embedded file: ${resolved.relative_path}`;
  }
}

async function resolveMarkdownImages(token) {
  await resolveMarkdownImagesIn(preview, token);
}

async function resolveMarkdownImagesIn(root, token) {
  const images = [...root.querySelectorAll("img")];
  for (const image of images) {
    if (token !== null && token !== state.renderToken) {
      return;
    }
    const src = image.getAttribute("src");
    if (!src || isRemoteSource(src) || src.startsWith("/api/vault/file")) {
      continue;
    }
    const resolved = await resolveVaultTarget(src);
    if (!resolved?.found || !resolved.is_image) {
      continue;
    }
    image.src = resolved.url;
    image.dataset.imageOrigin = resolved.target || src;
  }
}

function buildImageFigure(src, label, origin) {
  const figure = document.createElement("figure");
  figure.className = "embed-figure";

  const image = document.createElement("img");
  image.src = src;
  image.alt = label;
  image.dataset.imageOrigin = origin;
  figure.appendChild(image);

  if (label) {
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    figure.appendChild(caption);
  }

  return figure;
}

async function resolveVaultTarget(target) {
  if (state.vaultAccessMode === "browser" && state.vaultEntries.length) {
    return await resolveBrowserVaultTarget(target);
  }

  const params = new URLSearchParams({ target });
  if (state.currentNotePath) {
    params.set("note_path", state.currentNotePath);
  }

  try {
    const response = await fetch(`/api/vault/resolve?${params.toString()}`);
    return await response.json();
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function resolveBrowserVaultTarget(target) {
  const cleanTarget = normalizeTargetForLookup(target);
  if (!cleanTarget) {
    return { found: false, reason: "Empty target." };
  }

  const candidates = [];
  const direct = state.vaultPathMap.get(cleanTarget.toLowerCase());
  if (direct) {
    candidates.push(direct);
  }

  if (state.currentNotePath) {
    const relative = normalizePathSegments(joinRelativePath(dirnamePosix(state.currentNotePath), cleanTarget));
    const relativeCandidate = state.vaultPathMap.get(relative.toLowerCase());
    if (relativeCandidate) {
      candidates.push(relativeCandidate);
    }
  }

  if (!cleanTarget.includes("/")) {
    const nameMatches = state.vaultNameMap.get(cleanTarget.toLowerCase()) || [];
    if (nameMatches.length === 1) {
      candidates.push(nameMatches[0]);
    }
  }

  if (!candidates.length) {
    const suffixMatches = state.vaultEntries.filter((entry) =>
      entry.path.toLowerCase().endsWith(cleanTarget.toLowerCase())
    );
    if (suffixMatches.length === 1) {
      candidates.push(suffixMatches[0]);
    }
  }

  if (!candidates.length) {
    return { found: false, reason: `Could not resolve '${cleanTarget}'.` };
  }

  const entry = candidates[0];
  const url = await getBrowserEntryObjectUrl(entry);
  return {
    found: true,
    target: cleanTarget,
    name: entry.name,
    relative_path: entry.path,
    url,
    mime: entry.mime,
    is_image: entry.isImage,
  };
}

async function copyForOneNote() {
  try {
    const html = await buildClipboardHtml();
    const text = await buildPlainText();

    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } else {
      copyViaExecCommand(html);
    }
    setStatus("Copied rich text for OneNote.");
  } catch (error) {
    console.error(error);
    setStatus("Copy failed. Try a Chromium-based browser.");
  }
}

async function copyPlainText() {
  try {
    const text = await buildPlainText();
    await navigator.clipboard.writeText(text);
    setStatus("Copied plain text.");
  } catch (error) {
    console.error(error);
    setStatus("Plain-text copy failed.");
  }
}

async function buildClipboardHtml() {
  const clone = await buildRenderedFragment({
    joinSoftLines: joinLinesCheckbox.checked,
    breaks: !joinLinesCheckbox.checked,
  });
  convertTaskCheckboxes(clone);
  await embedImagesForClipboard(clone);
  inlineStyles(clone);
  return `<div>${clone.innerHTML}</div>`;
}

async function buildPlainText() {
  const clone = await buildRenderedFragment({
    joinSoftLines: joinLinesCheckbox.checked,
    breaks: !joinLinesCheckbox.checked,
  });
  convertTaskCheckboxes(clone);
  clone.querySelectorAll("img").forEach((image) => {
    const alt = image.alt || image.dataset.imageOrigin || "image";
    image.replaceWith(document.createTextNode(`[Image: ${alt}]`));
  });
  return clone.innerText.replace(/\n{3,}/g, "\n\n").trim();
}

async function buildRenderedFragment(options) {
  const container = document.createElement("article");
  container.className = "markdown-preview";
  await renderMarkdownInto(container, {
    joinSoftLines: options.joinSoftLines,
    breaks: options.breaks,
    token: null,
    ignoreTokenMismatch: true,
  });
  return container;
}

async function renderMarkdownInto(root, options) {
  const normalized = normalizeMarkdown(markdownInput.value, {
    joinSoftLines: options.joinSoftLines,
  });
  const rawHtml = marked.parse(normalized, {
    breaks: options.breaks,
  });
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ["class", "data-embed-target", "data-embed-label", "data-image-origin"],
    USE_PROFILES: { html: true },
  });
  root.innerHTML = safeHtml;

  if (!root.innerHTML.trim()) {
    return;
  }

  const token = options.ignoreTokenMismatch ? null : options.token;
  await resolveEmbedPlaceholdersIn(root, token);
  await resolveMarkdownImagesIn(root, token);
}

function convertTaskCheckboxes(root) {
  root.querySelectorAll("li").forEach((item) => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (!checkbox) {
      return;
    }

    const prefix = document.createTextNode(checkbox.checked ? "[x] " : "[ ] ");
    checkbox.remove();
    item.insertBefore(prefix, item.firstChild);
  });
}

async function embedImagesForClipboard(root) {
  const images = [...root.querySelectorAll("img")];
  for (const image of images) {
    const src = image.getAttribute("src");
    if (!src) {
      continue;
    }
    try {
      image.src = await toDataUrl(src);
    } catch (error) {
      console.error(error);
    }
  }
}

async function toDataUrl(src) {
  const response = await fetch(src);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function inlineStyles(root) {
  const baseStyle = [
    "font-family: 'Segoe UI', 'Yu Gothic UI', sans-serif",
    "font-size: 12pt",
    "line-height: 1.6",
    "color: #2b241c",
  ].join("; ");

  root.setAttribute("style", baseStyle);

  root.querySelectorAll("*").forEach((node) => {
    const styles = [];
    switch (node.tagName) {
      case "H1":
        styles.push(
          "font-size: 22pt",
          "font-weight: 700",
          "margin: 16pt 0 10pt",
          "border-bottom: 2px solid #f2d3ba",
          "padding-bottom: 4pt"
        );
        break;
      case "H2":
        styles.push("font-size: 18pt", "font-weight: 700", "margin: 14pt 0 8pt");
        break;
      case "H3":
        styles.push("font-size: 15pt", "font-weight: 700", "margin: 12pt 0 7pt");
        break;
      case "P":
        styles.push("margin: 0 0 10pt");
        break;
      case "UL":
      case "OL":
        styles.push("margin: 0 0 10pt 20pt", "padding-left: 18pt");
        break;
      case "LI":
        styles.push("margin: 0 0 4pt");
        break;
      case "BLOCKQUOTE":
        styles.push(
          "margin: 0 0 12pt",
          "padding: 9pt 11pt",
          "border-left: 4px solid #b9a388",
          "background: #f9efe4",
          "color: #54493d"
        );
        break;
      case "PRE":
        styles.push(
          "margin: 0 0 12pt",
          "padding: 12pt",
          "border-radius: 8pt",
          "background: #2a211b",
          "color: #f8efe2",
          "font-family: Consolas, monospace",
          "white-space: pre-wrap"
        );
        break;
      case "CODE":
        if (node.parentElement?.tagName !== "PRE") {
          styles.push(
            "padding: 1pt 4pt",
            "border-radius: 4pt",
            "background: #f3e2d2",
            "font-family: Consolas, monospace"
          );
        }
        break;
      case "TABLE":
        styles.push("border-collapse: collapse", "margin: 0 0 12pt", "width: 100%");
        break;
      case "TH":
        styles.push("border: 1px solid #d8cab4", "padding: 8pt", "background: #f3e0cb", "text-align: left");
        break;
      case "TD":
        styles.push("border: 1px solid #d8cab4", "padding: 8pt", "vertical-align: top");
        break;
      case "A":
        styles.push("color: #9b3d0f", "text-decoration: underline");
        break;
      case "MARK":
        styles.push("background: #ffed91", "padding: 0 2pt");
        break;
      case "HR":
        styles.push("border: 0", "border-top: 1px solid #d5c5af", "margin: 12pt 0");
        break;
      case "DIV":
        if (node.classList.contains("embed-placeholder")) {
          styles.push(
            "margin: 0 0 12pt",
            "padding: 9pt 11pt",
            "border: 1px dashed #bf8c61",
            "border-radius: 8pt",
            "background: #fff3e7",
            "color: #7b4d27"
          );
        }
        break;
      case "FIGURE":
        styles.push("margin: 0 0 12pt");
        break;
      case "FIGCAPTION":
        styles.push("margin-top: 4pt", "font-size: 10pt", "color: #786b5d");
        break;
      case "IMG":
        styles.push("display: block", "max-width: 100%", "height: auto", "border-radius: 8pt");
        break;
      case "SPAN":
        if (node.classList.contains("internal-link")) {
          styles.push("color: #864119", "font-weight: 600");
        }
        break;
      default:
        break;
    }

    if (styles.length) {
      node.setAttribute("style", styles.join("; "));
    }
  });
}

function copyViaExecCommand(html) {
  const buffer = document.createElement("div");
  buffer.contentEditable = "true";
  buffer.style.position = "fixed";
  buffer.style.left = "-9999px";
  buffer.innerHTML = html;
  document.body.appendChild(buffer);

  const range = document.createRange();
  range.selectNodeContents(buffer);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("copy");
  selection.removeAllRanges();
  buffer.remove();
}

function syncLabels() {
  vaultLabel.textContent = state.vaultRoot
    ? `Vault: ${state.vaultRoot}${state.vaultAccessMode === "browser" ? " (picker)" : ""}`
    : "Vault: not selected";
  const noteText = state.currentNotePath || state.currentNoteName || "pasted text";
  noteLabel.textContent = `Note: ${noteText}`;
}

function isRemoteSource(src) {
  return /^https?:\/\//i.test(src) || src.startsWith("data:");
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), waitMs);
  };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(message) {
  statusMessage.textContent = message;
}

async function indexBrowserVault(rootHandle) {
  const entries = [];

  async function walkDirectory(directoryHandle, prefix) {
    for await (const child of directoryHandle.values()) {
      const nextPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.kind === "directory") {
        await walkDirectory(child, nextPath);
        continue;
      }

      const mime = guessMimeFromName(child.name);
      entries.push({
        kind: child.kind,
        handle: child,
        name: child.name,
        path: nextPath,
        mime,
        isImage: isImageName(child.name, mime),
      });
    }
  }

  await walkDirectory(rootHandle, "");
  return entries;
}

function buildVaultPathMap(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    map.set(entry.path.toLowerCase(), entry);
  });
  return map;
}

function buildVaultNameMap(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = entry.name.toLowerCase();
    const list = map.get(key) || [];
    list.push(entry);
    map.set(key, list);
  });
  return map;
}

function normalizeTargetForLookup(target) {
  let value = decodeURIComponent(String(target || "").trim()).replaceAll("\\", "/");
  if (value.includes("|")) {
    value = value.split("|", 1)[0];
  }
  if (value.includes("?")) {
    value = value.split("?", 1)[0];
  }
  if (value.includes("#")) {
    value = value.split("#", 1)[0];
  }
  return normalizePathSegments(value);
}

function normalizePathSegments(path) {
  const rawSegments = String(path || "").split("/");
  const output = [];
  rawSegments.forEach((segment) => {
    if (!segment || segment === ".") {
      return;
    }
    if (segment === "..") {
      if (output.length) {
        output.pop();
      }
      return;
    }
    output.push(segment);
  });
  return output.join("/");
}

function joinRelativePath(base, target) {
  if (!base) {
    return target;
  }
  return `${base}/${target}`;
}

function dirnamePosix(path) {
  const normalized = String(path || "").replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function isMarkdownPath(path) {
  return /\.(md|markdown|txt)$/i.test(path);
}

function guessMimeFromName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function isImageName(name, mime) {
  return /\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(name) || mime.startsWith("image/");
}

async function getBrowserEntryObjectUrl(entry) {
  const existing = state.objectUrlMap.get(entry.path);
  if (existing) {
    return existing;
  }
  const file = await entry.handle.getFile();
  const url = URL.createObjectURL(file);
  state.objectUrlMap.set(entry.path, url);
  return url;
}

function resetObjectUrlCache() {
  state.objectUrlMap.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrlMap = new Map();
}
