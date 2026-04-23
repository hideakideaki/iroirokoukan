import argparse
import contextlib
import json
import mimetypes
import socket
import threading
import urllib.parse
import webbrowser
from dataclasses import dataclass, field
from functools import partial
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parent
TEXT_EXTENSIONS = {".md", ".markdown", ".txt"}
IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".svg",
    ".webp",
}


def choose_port(host: str, preferred: int) -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind((host, preferred))
        return sock.getsockname()[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start a local Obsidian-to-OneNote preview tool."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind.")
    parser.add_argument("--port", type=int, default=8765, help="Preferred port.")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically.",
    )
    return parser.parse_args()


def normalize_target(value: str) -> str:
    target = urllib.parse.unquote(value).strip().replace("\\", "/")
    if "|" in target:
        target = target.split("|", 1)[0]
    if "?" in target:
        target = target.split("?", 1)[0]
    if "#" in target:
        target = target.split("#", 1)[0]
    return target.strip()


def safe_resolve_within(root: Path, candidate: Path) -> Optional[Path]:
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
        return resolved
    except (FileNotFoundError, ValueError):
        return None


@dataclass
class VaultIndex:
    root: Optional[Path] = None
    by_relative: Dict[str, Path] = field(default_factory=dict)
    by_name: Dict[str, List[Path]] = field(default_factory=dict)

    def set_root(self, path: str) -> Dict[str, Any]:
        selected = Path(path).expanduser().resolve()
        if not selected.is_dir():
            raise ValueError("Selected path is not a directory.")

        by_relative: Dict[str, Path] = {}
        by_name: Dict[str, List[Path]] = {}
        for file_path in selected.rglob("*"):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(selected).as_posix()
            by_relative[rel] = file_path
            by_name.setdefault(file_path.name.lower(), []).append(file_path)

        self.root = selected
        self.by_relative = by_relative
        self.by_name = by_name
        return self.status()

    def status(self) -> Dict[str, Any]:
        return {
            "selected": self.root is not None,
            "root": str(self.root) if self.root else None,
            "file_count": len(self.by_relative),
        }

    def read_note(self, path: str) -> Dict[str, str]:
        note_path = Path(path).expanduser().resolve()
        if not note_path.is_file():
            raise FileNotFoundError(path)

        text = note_path.read_text(encoding="utf-8")
        note_rel = ""
        if self.root is not None:
            try:
                note_rel = note_path.relative_to(self.root).as_posix()
            except ValueError:
                note_rel = note_path.name

        return {"name": note_path.name, "path": note_rel, "text": text}

    def read_note_from_vault(self, relative_path: str) -> Dict[str, str]:
        if self.root is None:
            raise FileNotFoundError("No vault selected.")

        normalized = relative_path.replace("\\", "/").lstrip("/")
        note_path = safe_resolve_within(self.root, self.root / normalized)
        if note_path is None or not note_path.is_file():
            raise FileNotFoundError(relative_path)

        return self.read_note(str(note_path))

    def resolve_target(
        self, target: str, note_path: Optional[str] = None
    ) -> Dict[str, Any]:
        if self.root is None:
            return {"found": False, "reason": "No vault selected."}

        clean_target = normalize_target(target)
        if not clean_target:
            return {"found": False, "reason": "Empty target."}

        candidates: List[Path] = []
        posix_target = clean_target.lstrip("/")
        direct = self.by_relative.get(posix_target)
        if direct is not None:
            candidates.append(direct)

        if note_path:
            note_parent = PurePosixPath(note_path).parent
            relative_target = note_parent.joinpath(PurePosixPath(clean_target))
            relative_text = relative_target.as_posix().lstrip("/")
            note_candidate = self.by_relative.get(relative_text)
            if note_candidate is not None:
                candidates.append(note_candidate)
            else:
                safe = safe_resolve_within(self.root, self.root / relative_text)
                if safe is not None:
                    candidates.append(safe)

        safe_direct = safe_resolve_within(self.root, self.root / posix_target)
        if safe_direct is not None:
            candidates.append(safe_direct)

        if "/" not in clean_target:
            name_matches = self.by_name.get(Path(clean_target).name.lower(), [])
            if len(name_matches) == 1:
                candidates.append(name_matches[0])

        if not candidates:
            suffix_matches = [
                path
                for rel, path in self.by_relative.items()
                if rel.lower().endswith(posix_target.lower())
            ]
            if len(suffix_matches) == 1:
                candidates.append(suffix_matches[0])

        if not candidates:
            return {"found": False, "reason": f"Could not resolve '{clean_target}'."}

        resolved = candidates[0]
        rel = resolved.relative_to(self.root).as_posix()
        mime = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        return {
            "found": True,
            "target": clean_target,
            "name": resolved.name,
            "relative_path": rel,
            "url": f"/api/vault/file?path={urllib.parse.quote(rel)}",
            "mime": mime,
            "is_image": resolved.suffix.lower() in IMAGE_EXTENSIONS
            or mime.startswith("image/"),
        }

    def open_file(self, relative_path: str) -> Tuple[Path, str]:
        if self.root is None:
            raise FileNotFoundError("No vault selected.")

        decoded = urllib.parse.unquote(relative_path).replace("\\", "/").lstrip("/")
        candidate = safe_resolve_within(self.root, self.root / decoded)
        if candidate is None or not candidate.is_file():
            raise FileNotFoundError(relative_path)

        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        return candidate, mime


class AppServer(HTTPServer):
    def __init__(self, server_address, RequestHandlerClass):
        super().__init__(server_address, RequestHandlerClass)
        self.vault = VaultIndex()


class AppHandler(SimpleHTTPRequestHandler):
    server: AppServer

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/vault/status":
            self.send_json(self.server.vault.status())
            return

        if parsed.path == "/api/vault/resolve":
            query = urllib.parse.parse_qs(parsed.query)
            target = query.get("target", [""])[0]
            note_path = query.get("note_path", [""])[0] or None
            self.send_json(self.server.vault.resolve_target(target, note_path))
            return

        if parsed.path == "/api/vault/file":
            query = urllib.parse.parse_qs(parsed.query)
            rel_path = query.get("path", [""])[0]
            try:
                file_path, mime = self.server.vault.open_file(rel_path)
            except FileNotFoundError:
                self.send_error(HTTPStatus.NOT_FOUND, "File not found.")
                return

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.end_headers()
            with file_path.open("rb") as handle:
                self.wfile.write(handle.read())
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/vault/set-root":
            payload = self.read_json_body()
            selected = str(payload.get("path", "")).strip()
            if not selected:
                self.send_json({"selected": False, "error": "Vault path is required."}, status=400)
                return

            try:
                status = self.server.vault.set_root(selected)
            except ValueError as error:
                self.send_json({"selected": False, "error": str(error)}, status=400)
                return

            self.send_json(status)
            return

        if parsed.path == "/api/note/load":
            payload = self.read_json_body()
            selected = str(payload.get("path", "")).strip()
            if not selected:
                self.send_json({"selected": False, "error": "Note path is required."}, status=400)
                return
            try:
                if self.server.vault.root is not None and not Path(selected).is_absolute():
                    note_payload = self.server.vault.read_note_from_vault(selected)
                else:
                    note_payload = self.server.vault.read_note(selected)
            except (FileNotFoundError, UnicodeDecodeError) as error:
                self.send_json({"selected": False, "error": str(error)}, status=400)
                return

            note_payload["selected"] = True
            self.send_json(note_payload)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint.")

    def log_message(self, format: str, *args) -> None:
        super().log_message(format, *args)

    def send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}


def main() -> None:
    args = parse_args()
    port = choose_port(args.host, args.port)
    handler = partial(AppHandler, directory=str(ROOT))
    server = AppServer((args.host, port), handler)
    url = f"http://{args.host}:{port}/web/"

    if not args.no_browser:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()

    print("Obsidian2OneNote preview server")
    print(f"Open: {url}")
    print("Stop: Ctrl+C")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
