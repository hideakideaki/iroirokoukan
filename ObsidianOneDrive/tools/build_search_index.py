from __future__ import annotations

from pathlib import Path
import json
import re
from datetime import datetime, timezone
from html import escape
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
NOTES_DIR = ROOT / "notes"
ATTACHMENTS_DIR = ROOT / "attachments"
SEARCH_APP_DIR = ROOT / "search-app"
OUTPUT_PATH = SEARCH_APP_DIR / "search-index.json"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
PDF_EXTS = {".pdf"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi"}

def iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).astimezone().isoformat()

def file_type(path_str: str) -> str:
    ext = Path(path_str).suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in PDF_EXTS:
        return "pdf"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in VIDEO_EXTS:
        return "video"
    return "file"

def extract_title(text: str, path: Path) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem

def extract_headings(text: str) -> list[str]:
    result = []
    for line in text.splitlines():
        m = re.match(r"^\s{0,3}#{1,6}\s+(.*)$", line)
        if m:
            result.append(m.group(1).strip())
    return result

def extract_tags(text: str) -> list[str]:
    tags = []
    seen = set()
    for tag in re.findall(r"(?<![\w/])#([A-Za-z0-9_\-ぁ-んァ-ヶ一-龠々]+)", text):
        if tag not in seen:
            tags.append(tag)
            seen.add(tag)
    return tags

def resolve_note_target(raw: str, current_note: Path, note_map: dict[str, str]) -> Optional[str]:
    key = raw.strip()
    key = re.sub(r"\.md$", "", key, flags=re.IGNORECASE)
    key = key.replace("\\", "/").strip()

    if key in note_map:
        return note_map[key]

    for k, v in note_map.items():
        if Path(k).stem == Path(key).stem:
            return v

    current_rel = current_note.relative_to(ROOT).parent
    candidate = (current_rel / key).with_suffix(".md").as_posix()
    if candidate in note_map:
        return note_map[candidate]

    return None

def build_note_map(md_files: list[Path]) -> dict[str, str]:
    note_map: dict[str, str] = {}
    for p in md_files:
        rel = p.relative_to(ROOT).as_posix()
        note_map[rel] = rel
        note_map[p.relative_to(NOTES_DIR).as_posix()] = rel
        note_map[p.stem] = rel
    return note_map

def convert_body(text: str, current_note: Path, note_map: dict[str, str]) -> tuple[str, list[dict], list[dict]]:
    attachments: list[dict] = []
    note_links: list[dict] = []
    seen_att = set()
    seen_links = set()

    def add_attachment(label: str, rel_original: str, resolved: str):
        key = (label, resolved)
        if key in seen_att:
            return
        seen_att.add(key)
        attachments.append({
            "label": label,
            "resolved": resolved,
            "type": file_type(rel_original),
        })

    def add_note_link(label: str, target: str):
        key = (label, target)
        if key in seen_links:
            return
        seen_links.add(key)
        note_links.append({
            "label": label,
            "target": target,
        })

    def replace_embed(match: re.Match) -> str:
        inner = match.group(1).strip()
        inner_no_size = inner.split("|")[0].strip()
        filename = Path(inner_no_size).name
        label = filename
        rel = inner_no_size.replace("\\", "/")
        if not rel.startswith("attachments/"):
            rel = f"attachments/{Path(rel).name}"
        resolved = "../" + rel
        add_attachment(label, rel, resolved)
        return f"![{escape(label)}]({resolved})"

    text = re.sub(r"!\[\[([^\]]+)\]\]", replace_embed, text)

    def replace_wikilink(match: re.Match) -> str:
        inner = match.group(1).strip()
        target_raw, label = (inner.split("|", 1) + [""])[:2]
        target_raw = target_raw.strip()
        label = label.strip() or Path(target_raw).stem

        ext = Path(target_raw).suffix.lower()
        if ext:
            rel = target_raw.replace("\\", "/")
            if not rel.startswith("attachments/"):
                rel = f"attachments/{Path(rel).name}"
            resolved = "../" + rel
            add_attachment(label, rel, resolved)
            return f"[{escape(label)}]({resolved})"

        target = resolve_note_target(target_raw, current_note, note_map)
        if target:
            add_note_link(label, target)
            return f'<a href="#" class="note-link" data-note="{escape(target, quote=True)}">{escape(label)}</a>'
        return escape(label)

    text = re.sub(r"\[\[([^\]]+)\]\]", replace_wikilink, text)

    def replace_md_image(match: re.Match) -> str:
        alt, path_str = match.group(1), match.group(2).strip()
        rel = path_str.replace("\\", "/")
        if rel.startswith("./") or rel.startswith("../"):
            resolved = rel
            rel_for_type = rel
        else:
            resolved = "../" + rel.lstrip("/")
            rel_for_type = rel
        add_attachment(alt or Path(rel).name, rel_for_type, resolved)
        return f"![{alt}]({resolved})"
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", replace_md_image, text)

    def replace_md_link(match: re.Match) -> str:
        label, path_str = match.group(1), match.group(2).strip()
        if path_str.startswith("http://") or path_str.startswith("https://") or path_str.startswith("#"):
            return match.group(0)
        rel = path_str.replace("\\", "/")
        resolved = rel if rel.startswith("./") or rel.startswith("../") else "../" + rel.lstrip("/")
        add_attachment(label or Path(rel).name, rel, resolved)
        return f"[{label}]({resolved})"
    text = re.sub(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)", replace_md_link, text)

    return text, note_links, attachments

def main() -> None:
    md_files = sorted(NOTES_DIR.rglob("*.md"))
    note_map = build_note_map(md_files)
    notes = []

    for md_file in md_files:
        raw = md_file.read_text(encoding="utf-8")
        body, links_to_notes, attachments = convert_body(raw, md_file, note_map)
        notes.append({
            "id": md_file.relative_to(ROOT).as_posix(),
            "title": extract_title(raw, md_file),
            "path": md_file.relative_to(ROOT).as_posix(),
            "body": body,
            "headings": extract_headings(raw),
            "tags": extract_tags(raw),
            "links_to_notes": links_to_notes,
            "attachments": attachments,
            "mtime": iso_mtime(md_file),
        })

    payload = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "vault": {
            "notes_dir": "notes",
            "attachments_dir": "attachments",
        },
        "notes": notes,
    }

    SEARCH_APP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"generated: {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
