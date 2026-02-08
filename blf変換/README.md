# BLF to MF4 Converter

This tool converts Vector BLF CAN logs to MF4 by writing raw byte channels per CAN ID.

## Requirements

- Python 3.10+
- Install dependencies:

```bash
pip install -r requirements.txt
```

## Usage

```bash
python blf_to_mf4.py input.blf output.mf4
```

Decode with DBC:

```bash
python blf_to_mf4.py input.blf output.mf4 --dbc path/to/file.dbc
```

Decoded only (default; no raw BYTE/DLC/FLAGS):

```bash
python blf_to_mf4.py input.blf output.mf4 --dbc path/to/file.dbc
```

Include raw BYTE/DLC/FLAGS:

```bash
python blf_to_mf4.py input.blf output.mf4 --dbc path/to/file.dbc --raw
```

Config-driven run (recommended):

```bash
python blf_to_mf4.py --config blf_to_mf4_config.json
```

If no decoded signals exist but you still want raw output, set `allow_raw_when_no_decode` in the config (see below).

Multiple DBC files:

```bash
python blf_to_mf4.py input.blf output.mf4 --dbc a.dbc --dbc b.dbc
```

Time window (seconds from first message; output timestamps remain absolute):

```bash
python blf_to_mf4.py input.blf output.mf4 --t-start 10 --t-end 20
```

Convert MF4 to CSV:

```bash
python mf4_to_csv.py input.mf4 output.csv
```

Resample to fixed step (seconds):

```bash
python mf4_to_csv.py input.mf4 output.csv --raster 0.01
```

Config-driven run (recommended):

```bash
python mf4_to_csv.py --config mf4_to_csv_config.json
```

MF4 to CSV note:

- Only decoded signals (group comment `dbc_decoded_signals`) are exported.
- If `allow_raw_when_no_decode` is true in the config, export all channels when decoded signals are missing.

## Output layout

For each unique CAN ID (and channel / standard vs extended / CAN vs CAN FD), a channel group is created with:

- 8 (CAN) or 64 (CAN FD) byte channels: `<prefix>_BYTEn`
- DLC channel: `<prefix>_DLC`
- FLAGS channel: `<prefix>_FLAGS`

Flags bitfield:

- bit0: error frame
- bit1: remote frame
- bit2: extended ID
- bit3: CAN FD
- bit4: bitrate switch
- bit5: error state indicator

## Notes

- If you pass `--dbc`, decoded signals are appended as a separate channel group `dbc_decoded_signals`.
- Decoded signal names: `CAN<channel>_0x<id>_<MessageName>_<SignalName>`.
- Large BLF files are loaded into memory per CAN ID.

## Config format (BLF -> MF4)

`blf_to_mf4_config.json` example:

```json
{
  "input": "input.blf",
  "output": "output.mf4",
  "dbc": ["path/to/file.dbc"],
  "t_start": 10,
  "t_end": 20,
  "raw": false,
  "stats": true,
  "id_whitelist": ["0x100", "0x200"],
  "signal_whitelist": ["WarningCode", "VehicleSpeed", "MsgName.SignalName"],
  "signal_blacklist": ["UnusedSig", "MsgName.UnusedSig"],
  "allow_raw_when_no_decode": true
}
```

## Config format (MF4 -> CSV)

`mf4_to_csv_config.json` example:

```json
{
  "input": "output.mf4",
  "output": "output.csv",
  "raster": 0.01,
  "allow_raw_when_no_decode": true
}
```
