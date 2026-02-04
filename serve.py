#!/usr/bin/env python3
"""Local TensorFlow HDR preview server.

Run `python3 serve.py` from the repo root, then open http://localhost:8000.
The script decodes `assets/HDR_041_Path_Ref.hdr` with TensorFlow, applies a
simple tone map, writes `generated/hdr.png`, and serves the repo via the
built-in HTTP server so the HTML page can show the PNG.

Note: TensorFlow must be installed in this Python environment. A CPU wheel is
fine (e.g., `pip install tensorflow-cpu`).
"""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Tuple

import numpy as np
import tensorflow as tf


REPO_ROOT = Path(__file__).parent
HDR_PATH = REPO_ROOT / "assets" / "HDR_041_Path_Ref.hdr"
GENERATED_DIR = REPO_ROOT / "generated"
PNG_PATH = GENERATED_DIR / "hdr.png"


def _parse_resolution(line: str) -> Tuple[int, int]:
    parts = line.split()
    if len(parts) != 4 or parts[0][-1].upper() != "Y" or parts[2][-1].upper() != "X":
        raise ValueError(f"Unexpected resolution string: {line!r}")
    height = int(parts[1])
    width = int(parts[3])
    return height, width


def load_rgbe(path: Path) -> np.ndarray:
    """Decode a Radiance HDR (RGBE) file into a float32 numpy array."""

    data = path.read_bytes()
    offset = 0

    # Skip header lines until the blank delimiter
    while True:
        nl = data.find(b"\n", offset)
        if nl == -1:
            raise ValueError("HDR header not terminated")
        line = data[offset:nl].decode("ascii", "ignore").strip()
        offset = nl + 1
        if line == "":
            break

    # Resolution line follows the blank line
    nl = data.find(b"\n", offset)
    if nl == -1:
        raise ValueError("Missing resolution string")
    res_line = data[offset:nl].decode("ascii", "ignore").strip()
    offset = nl + 1
    height, width = _parse_resolution(res_line)

    # Allocate RGBE buffer
    rgbe = np.empty((height, width, 4), dtype=np.uint8)

    for row in range(height):
        if offset + 4 > len(data):
            raise ValueError("Unexpected EOF in scanline header")
        if data[offset] != 2 or data[offset + 1] != 2:
            raise ValueError("Only new-style RLE scanlines are supported")
        row_width = (data[offset + 2] << 8) | data[offset + 3]
        if row_width != width:
            raise ValueError(f"Scanline width mismatch at row {row}: {row_width} != {width}")
        offset += 4

        for channel in range(4):
            col = 0
            while col < width:
                if offset >= len(data):
                    raise ValueError("Unexpected EOF inside RLE data")
                count = data[offset]
                offset += 1
                if count > 128:
                    run_length = count - 128
                    if offset >= len(data):
                        raise ValueError("Truncated RLE run")
                    value = data[offset]
                    offset += 1
                    rgbe[row, col : col + run_length, channel] = value
                    col += run_length
                else:
                    run_length = count
                    if offset + run_length > len(data):
                        raise ValueError("Truncated RLE literal")
                    rgbe[row, col : col + run_length, channel] = np.frombuffer(
                        data, dtype=np.uint8, count=run_length, offset=offset
                    )
                    offset += run_length
                    col += run_length

    return rgbe.astype(np.float32)


def rgbe_to_linear(rgbe: np.ndarray) -> tf.Tensor:
    """Convert RGBE data to linear HDR TensorFlow tensor."""

    exponent = rgbe[:, :, 3] - 128.0
    scale = np.exp2(exponent) / 256.0
    rgb = rgbe[:, :, :3] * scale[:, :, None]
    return tf.convert_to_tensor(rgb, dtype=tf.float32)


def tone_map(linear_rgb: tf.Tensor, exposure: float = 1.8) -> tf.Tensor:
    boosted = linear_rgb * exposure
    mapped = boosted / (1.0 + boosted)  # simple Reinhard tone map
    srgb = tf.where(
        mapped <= 0.0031308,
        12.92 * mapped,
        1.055 * tf.pow(mapped, 1.0 / 2.4) - 0.055,
    )
    return tf.clip_by_value(srgb, 0.0, 1.0)


def write_png(linear_rgb: tf.Tensor, dst: Path) -> None:
    srgb = tone_map(linear_rgb)
    u8 = tf.cast(tf.round(srgb * 255.0), tf.uint8)
    png_bytes = tf.io.encode_png(u8)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tf.io.write_file(str(dst), png_bytes)


def build_image() -> None:
    print(f"Decoding {HDR_PATH} with TensorFlow…")
    rgbe = load_rgbe(HDR_PATH)
    linear = rgbe_to_linear(rgbe)
    write_png(linear, PNG_PATH)
    size_mb = PNG_PATH.stat().st_size / (1024 * 1024)
    print(f"Wrote {PNG_PATH} ({size_mb:.2f} MB)")


def serve() -> None:
    os.chdir(REPO_ROOT)
    handler = SimpleHTTPRequestHandler
    server = ThreadingHTTPServer(("", 8000), handler)
    print("Serving http://localhost:8000 (Ctrl+C to stop)…")
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    if not HDR_PATH.exists():
        raise SystemExit(f"Missing HDR asset at {HDR_PATH}")

    build_image()
    serve()
