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

async function refreshVaultStatus() {
  try {
    const response = await fetch("/api/vault/status");
    const payload = await response.json();
    state.vaultRoot = payload.root || null;
    syncLabels();
  } catch (error) {
    console.error(error);
    setStatus("Could not read vault status.");
  }
}

async function selectVault() {
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
    syncLabels();
    setStatus(`Vault indexed: ${payload.file_count} files`);
    render();
  } catch (error) {
    console.error(error);
    setStatus("Vault selection failed.");
  }
}

async function openVaultNote() {
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

async function handleFileOpen(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  const text = await file.text();
  markdownInput.value = text;
  state.currentNotePath = null;
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
  });
  convertTaskCheckboxes(clone);
  await embedImagesForClipboard(clone);
  inlineStyles(clone);
  return `<div>${clone.innerHTML}</div>`;
}

async function buildPlainText() {
  const clone = await buildRenderedFragment({
    joinSoftLines: joinLinesCheckbox.checked,
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
    breaks: false,
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
    ? `Vault: ${state.vaultRoot}`
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
