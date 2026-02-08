from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from asammdf import MDF


def decoded_channel_refs(mdf: MDF) -> list[tuple[str, int, int]]:
    refs: list[tuple[str, int, int]] = []
    for name, links in mdf.channels_db.items():
        for group, _index in links:
            group_obj = mdf.groups[group]
            comment = getattr(group_obj, "comment", "")
            if comment == "dbc_decoded_signals":
                refs.append((name, group, _index))
                break
    if refs:
        return refs

    # Fallback: include anything that is not raw bytes/DLC/FLAGS
    for name in mdf.channels_db.keys():
        if name.endswith("_DLC") or name.endswith("_FLAGS"):
            continue
        if re.search(r"_BYTE\\d+$", name):
            continue
        for group, _index in mdf.channels_db[name]:
            refs.append((name, group, _index))
    return refs


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def convert(mf4_path: Path, csv_path: Path, raster: float | None, allow_raw: bool) -> None:
    mdf = MDF(str(mf4_path))
    decoded = decoded_channel_refs(mdf)
    if not decoded:
        if allow_raw:
            df = mdf.to_dataframe(raster=raster)
            df.to_csv(csv_path, index=True)
            return
        raise SystemExit("No decoded signals found (dbc_decoded_signals or name pattern).")
    mdf = mdf.filter(channels=decoded)
    df = mdf.to_dataframe(raster=raster)
    df.to_csv(csv_path, index=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert MF4 to CSV using asammdf.")
    parser.add_argument("input", type=Path, nargs="?", help="Input .mf4 file")
    parser.add_argument("output", type=Path, nargs="?", help="Output .csv file")
    parser.add_argument("--raster", type=float, default=None, help="Resample to fixed step (seconds)")
    parser.add_argument("--config", type=Path, default=None, help="JSON config file")
    args = parser.parse_args()

    config_data: dict = {}
    if args.config is not None:
        if not args.config.exists():
            raise SystemExit(f"Config not found: {args.config}")
        config_data = load_json(args.config)

    input_path = Path(str(config_data.get("input"))) if "input" in config_data else args.input
    output_path = Path(str(config_data.get("output"))) if "output" in config_data else args.output
    if input_path is None or output_path is None:
        raise SystemExit("input/output must be provided (args or config).")
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    raster = config_data.get("raster", args.raster)

    allow_raw = bool(config_data.get("allow_raw_when_no_decode", False))
    convert(input_path, output_path, raster, allow_raw)


if __name__ == "__main__":
    main()
