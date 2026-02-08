from __future__ import annotations

import argparse
import json
import time
import tracemalloc
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np
import can
import cantools
from cantools.database.errors import DecodeError
from asammdf import MDF, Signal


MAX_CAN_BYTES = 8
MAX_CANFD_BYTES = 64


@dataclass
class GroupBuffer:
    max_len: int
    timestamps: List[float] = field(default_factory=list)
    data_bytes: List[List[int]] = field(default_factory=list)
    dlc: List[int] = field(default_factory=list)
    flags: List[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.data_bytes:
            self.data_bytes = [[] for _ in range(self.max_len)]

    def add(self, ts: float, data: bytes, dlc: int, flags: int) -> None:
        self.timestamps.append(ts)
        self.dlc.append(dlc)
        self.flags.append(flags)
        for i in range(self.max_len):
            self.data_bytes[i].append(data[i] if i < len(data) else 0)


@dataclass
class SignalBuffer:
    timestamps: List[float] = field(default_factory=list)
    samples: List[float] = field(default_factory=list)

    def add(self, ts: float, value: float) -> None:
        self.timestamps.append(ts)
        self.samples.append(value)


def iter_blf(path: Path) -> Iterable[can.Message]:
    with can.BLFReader(str(path)) as reader:
        for msg in reader:
            if isinstance(msg, can.Message):
                yield msg


def msg_flags(msg: can.Message) -> int:
    flags = 0
    if getattr(msg, "is_error_frame", False):
        flags |= 1 << 0
    if getattr(msg, "is_remote_frame", False):
        flags |= 1 << 1
    if getattr(msg, "is_extended_id", False):
        flags |= 1 << 2
    if getattr(msg, "is_fd", False):
        flags |= 1 << 3
    if getattr(msg, "bitrate_switch", False):
        flags |= 1 << 4
    if getattr(msg, "error_state_indicator", False):
        flags |= 1 << 5
    return flags


def group_key(msg: can.Message) -> Tuple[int, int, bool, bool]:
    channel = int(getattr(msg, "channel", 0) or 0)
    return (channel, int(msg.arbitration_id), bool(msg.is_extended_id), bool(getattr(msg, "is_fd", False)))


def group_comment(key: Tuple[int, int, bool, bool]) -> str:
    channel, arb_id, is_ext, is_fd = key
    parts = [f"channel={channel}", f"id=0x{arb_id:X}"]
    parts.append("extended" if is_ext else "standard")
    parts.append("canfd" if is_fd else "can")
    return ", ".join(parts)


def group_prefix(key: Tuple[int, int, bool, bool]) -> str:
    channel, arb_id, is_ext, is_fd = key
    ext = "EXT" if is_ext else "STD"
    fd = "FD" if is_fd else "CAN"
    return f"CAN{channel}_{fd}_{ext}_0x{arb_id:X}"

def load_dbcs(paths: List[Path]) -> cantools.database.Database | None:
    if not paths:
        return None
    db = cantools.database.Database()
    for path in paths:
        db.add_dbc_file(str(path))
    return db


def normalize_sample(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float, np.number)):
        return float(value)
    return None


def decoded_signal_name(channel: int, frame_id: int, message_name: str, signal_name: str) -> str:
    return f"CAN{channel}_0x{frame_id:X}_{message_name}_{signal_name}"


def parse_id_list(values: List[str]) -> set[int]:
    ids: set[int] = set()
    for value in values:
        value = value.strip()
        if not value:
            continue
        if value.lower().startswith("0x"):
            ids.add(int(value, 16))
        else:
            ids.add(int(value))
    return ids


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_filter_config(data: dict) -> tuple[set[int], set[str], set[str], bool]:
    id_list = [str(v) for v in data.get("id_whitelist", [])]
    sig_whitelist = {str(v) for v in data.get("signal_whitelist", [])}
    sig_blacklist = {str(v) for v in data.get("signal_blacklist", [])}
    allow_raw = bool(data.get("allow_raw_when_no_decode", False))
    return parse_id_list(id_list), sig_whitelist, sig_blacklist, allow_raw


def convert(
    blf_path: Path,
    mf4_path: Path,
    dbc_paths: List[Path],
    time_start: float | None,
    time_end: float | None,
    decoded_only: bool,
    filter_data: dict,
    report_stats: bool,
) -> None:
    buffers: Dict[Tuple[int, int, bool, bool], GroupBuffer] = {}
    decoded: Dict[str, SignalBuffer] = {}
    db = load_dbcs(dbc_paths)
    id_whitelist, sig_whitelist, sig_blacklist, allow_raw_when_no_decode = parse_filter_config(filter_data)
    t0: float | None = None
    start_time = time.perf_counter()
    if report_stats:
        tracemalloc.start()

    for msg in iter_blf(blf_path):
        if t0 is None:
            t0 = float(msg.timestamp)
        rel_ts = float(msg.timestamp) - t0
        if time_start is not None and rel_ts < time_start:
            continue
        if time_end is not None and rel_ts > time_end:
            continue

        if id_whitelist and int(msg.arbitration_id) not in id_whitelist:
            continue

        data = bytes(msg.data)
        dlc = int(getattr(msg, "dlc", len(data)))
        if not decoded_only:
            key = group_key(msg)
            max_len = MAX_CANFD_BYTES if key[3] else MAX_CAN_BYTES
            buf = buffers.get(key)
            if buf is None:
                buf = GroupBuffer(max_len=max_len)
                buffers[key] = buf
            buf.add(float(msg.timestamp), data, dlc, msg_flags(msg))
        if db is not None:
            try:
                decoded_values = db.decode_message(msg.arbitration_id, data, decode_choices=False)
            except (KeyError, DecodeError, ValueError):
                decoded_values = None
            if decoded_values:
                channel = int(getattr(msg, "channel", 0) or 0)
                message = db.get_message_by_frame_id(msg.arbitration_id)
                for name, value in decoded_values.items():
                    msg_sig = f"{message.name}.{name}"
                    if sig_whitelist and name not in sig_whitelist and msg_sig not in sig_whitelist:
                        continue
                    if name in sig_blacklist or msg_sig in sig_blacklist:
                        continue
                    sample = normalize_sample(value)
                    if sample is None:
                        continue
                    sig_name = decoded_signal_name(channel, msg.arbitration_id, message.name, name)
                    sig_buf = decoded.get(sig_name)
                    if sig_buf is None:
                        sig_buf = SignalBuffer()
                        decoded[sig_name] = sig_buf
                    sig_buf.add(float(msg.timestamp), sample)

    if not buffers and not decoded:
        raise SystemExit("No CAN messages found in BLF.")

    mdf = MDF()
    if not decoded_only:
        for key, buf in buffers.items():
            ts = np.asarray(buf.timestamps, dtype=np.float64)
            prefix = group_prefix(key)
            signals: List[Signal] = []

            for i in range(buf.max_len):
                samples = np.asarray(buf.data_bytes[i], dtype=np.uint8)
                signals.append(Signal(samples=samples, timestamps=ts, name=f"{prefix}_BYTE{i}"))

            signals.append(Signal(samples=np.asarray(buf.dlc, dtype=np.uint8), timestamps=ts, name=f"{prefix}_DLC"))
            signals.append(Signal(samples=np.asarray(buf.flags, dtype=np.uint8), timestamps=ts, name=f"{prefix}_FLAGS"))

            mdf.append(signals, comment=group_comment(key))

    if decoded:
        signals = []
        for name, buf in decoded.items():
            ts = np.asarray(buf.timestamps, dtype=np.float64)
            samples = np.asarray(buf.samples, dtype=np.float64)
            signals.append(Signal(samples=samples, timestamps=ts, name=name))
        mdf.append(signals, comment="dbc_decoded_signals")
    elif decoded_only:
        if allow_raw_when_no_decode and buffers:
            for key, buf in buffers.items():
                ts = np.asarray(buf.timestamps, dtype=np.float64)
                prefix = group_prefix(key)
                signals: List[Signal] = []

                for i in range(buf.max_len):
                    samples = np.asarray(buf.data_bytes[i], dtype=np.uint8)
                    signals.append(Signal(samples=samples, timestamps=ts, name=f"{prefix}_BYTE{i}"))

                signals.append(Signal(samples=np.asarray(buf.dlc, dtype=np.uint8), timestamps=ts, name=f"{prefix}_DLC"))
                signals.append(Signal(samples=np.asarray(buf.flags, dtype=np.uint8), timestamps=ts, name=f"{prefix}_FLAGS"))

                mdf.append(signals, comment=group_comment(key))
        else:
            raise SystemExit("No decoded signals found; MF4 would be empty.")

    mdf.save(str(mf4_path), overwrite=True)

    if report_stats:
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        elapsed = time.perf_counter() - start_time
        print(f"Elapsed seconds: {elapsed:.3f}")
        print(f"Peak Python memory: {peak / (1024 * 1024):.2f} MiB")


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert CAN BLF logs to MF4 (raw bytes + optional DBC decode).")
    parser.add_argument("input", type=Path, nargs="?", help="Input .blf file")
    parser.add_argument("output", type=Path, nargs="?", help="Output .mf4 file")
    parser.add_argument("--config", type=Path, default=None, help="JSON config file")
    parser.add_argument("--dbc", type=Path, action="append", default=[], help="DBC file(s) to decode")
    parser.add_argument("--t-start", type=float, default=None, help="Start time (seconds) from first message")
    parser.add_argument("--t-end", type=float, default=None, help="End time (seconds) from first message")
    parser.add_argument("--stats", action="store_true", help="Print conversion time and peak Python memory")
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Include raw BYTE/DLC/FLAGS channels in addition to decoded signals",
    )
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

    dbc_list = config_data.get("dbc", None)
    if dbc_list is not None:
        dbc_paths = [Path(str(p)) for p in dbc_list]
    else:
        dbc_paths = args.dbc

    missing = [p for p in dbc_paths if not p.exists()]
    if missing:
        raise SystemExit(f"DBC not found: {', '.join(str(p) for p in missing)}")

    t_start = config_data.get("t_start", args.t_start)
    t_end = config_data.get("t_end", args.t_end)
    if t_start is not None and t_end is not None and t_start > t_end:
        raise SystemExit("t-start must be <= t-end.")

    raw = bool(config_data.get("raw", args.raw))
    stats = bool(config_data.get("stats", args.stats))

    filter_data = config_data

    convert(
        input_path,
        output_path,
        dbc_paths,
        t_start,
        t_end,
        not raw,
        filter_data,
        stats,
    )


if __name__ == "__main__":
    main()
