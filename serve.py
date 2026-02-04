#!/usr/bin/env python3
"""TensorFlow gain-map splitter for Ultra HDR sample.

Run `python3 serve.py` from repo root, then open http://localhost:8000`.
It pulls one sample from the cloned Ultra_HDR_Samples repo (Originals + SDR
Emulation). Using TensorFlow it:
  - loads the emulated SDR base and HDR versions,
  - derives an approximate gain map (HDR / SDR in linear space),
  - recreates a boosted image (SDR * gain) to verify math,
  - writes PNGs to `generated/`: base.png, hdr.png, gain.png, boosted.png.

Slider in index.html compares base.png vs hdr.png; gain.png is shown below.
"""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import base64

import tensorflow as tf


REPO_ROOT = Path(__file__).parent
ORIG_REPO = REPO_ROOT / "originals"
ORIG_DIR = ORIG_REPO / "Originals"

# Choose which numbered sample to use (01–10). Set UHD_SAMPLE env or edit default.
SAMPLE_ID = os.environ.get("UHD_SAMPLE", "01")
HDR_SRC = ORIG_DIR / f"Ultra_HDR_Samples_Originals_{SAMPLE_ID}.jpg"

GENERATED_DIR = REPO_ROOT / "generated"
BASE_PATH = GENERATED_DIR / "base.png"
HDR_PATH = GENERATED_DIR / "hdr.png"
GAIN_PATH = GENERATED_DIR / "gain.png"
BOOSTED_PATH = GENERATED_DIR / "boosted.png"
VIEW_PATH = GENERATED_DIR / "view.html"
EV_BOOST = float(os.environ.get("UHD_EV", "0.0"))


def to_linear_srgb(img_sdr: tf.Tensor) -> tf.Tensor:
    """Convert uint8 sRGB to linear float tensor in [0,1]."""
    srgb = tf.image.convert_image_dtype(img_sdr, tf.float32)
    return tf.where(
        srgb <= 0.04045,
        srgb / 12.92,
        tf.pow((srgb + 0.055) / 1.055, 2.4),
    )


def to_srgb(linear: tf.Tensor) -> tf.Tensor:
    """Convert linear [0,1] to sRGB float [0,1]."""
    return tf.where(
        linear <= 0.0031308,
        linear * 12.92,
        1.055 * tf.pow(linear, 1.0 / 2.4) - 0.055,
    )


def estimate_gain_from_luminance(hdr_lin: tf.Tensor) -> tf.Tensor:
    """Estimate a gain map by dividing luminance by a local average (blur)."""
    weights = tf.constant([0.2627, 0.6780, 0.0593], dtype=tf.float32)
    lum = tf.reduce_sum(hdr_lin * weights, axis=-1, keepdims=True)
    # 9x9 box blur via average pooling; add batch dim for TF pooling
    base = tf.nn.avg_pool2d(lum[tf.newaxis, ...], ksize=9, strides=1, padding="SAME")[0]
    gain = lum / (base + 1e-5)
    return tf.clip_by_value(gain, 0.5, 4.0)


def write_png(image_f32: tf.Tensor, dst: Path) -> None:
    """Write float image [0,1] to PNG uint8."""
    srgb = to_srgb(tf.clip_by_value(image_f32, 0.0, 1.0))
    u8 = tf.image.convert_image_dtype(srgb, tf.uint8, saturate=True)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tf.io.write_file(str(dst), tf.io.encode_png(u8))


def apply_ev(linear: tf.Tensor, ev: float) -> tf.Tensor:
    """Simple exposure shift: clip((im * 2**ev), 0, 1)."""
    scale = tf.pow(tf.constant(2.0, dtype=tf.float32), ev)
    return tf.clip_by_value(linear * scale, 0.0, 1.0)


def build_images() -> None:
    if not HDR_SRC.exists():
        raise SystemExit(f"Missing sample file: {HDR_SRC}")

    print(f"Decoding sample {SAMPLE_ID} from {ORIG_DIR}…")
    hdr_jpg = tf.io.read_file(str(HDR_SRC))
    hdr_img = tf.image.decode_jpeg(hdr_jpg, channels=3)
    hdr_lin = to_linear_srgb(hdr_img)

    gain = estimate_gain_from_luminance(hdr_lin)
    gain_rgb = tf.repeat(gain, repeats=3, axis=-1)

    # Derive an approximate SDR base by dividing out gain.
    base_lin = tf.clip_by_value(hdr_lin / (gain_rgb + 1e-5), 0.0, 1.0)

    gain_gray = tf.reduce_mean(gain, axis=-1, keepdims=True)
    gain_norm = gain_gray / (tf.reduce_max(gain_gray) + 1e-6)

    boosted = apply_ev(base_lin * gain_rgb, EV_BOOST)

    write_png(base_lin, BASE_PATH)
    write_png(hdr_lin, HDR_PATH)
    write_png(tf.repeat(gain_norm, repeats=3, axis=-1), GAIN_PATH)
    write_png(boosted, BOOSTED_PATH)

    print(f"Generated: {BASE_PATH.name}, {HDR_PATH.name}, {GAIN_PATH.name}, {BOOSTED_PATH.name}")

    # Build self-contained HTML with embedded PNGs so it can be opened directly.
    def b64(path: Path) -> str:
        return base64.b64encode(path.read_bytes()).decode("ascii")

    view_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ultra HDR Split (sample {SAMPLE_ID})</title>
  <style>
    :root {{
      --accent: #7dd3fc;
      --bg: #0f1014;
      --panel: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.12);
    }}
    body {{
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: #e7ecf2;
      padding: 18px;
    }}
    h1 {{ margin: 0 0 10px; }}
    .shell {{
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
    }}
    .compare {{
      position: relative;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      border-radius: 10px;
      background: #05070c;
    }}
    .layer {{
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }}
    .boosted {{ clip-path: inset(0 50% 0 0); transition: clip-path 0.2s ease; }}
    .slider {{
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      appearance: none;
      background: transparent;
      cursor: ew-resize;
    }}
    .slider::-webkit-slider-thumb {{
      appearance: none;
      width: 6px; height: 100%;
      background: var(--accent);
      box-shadow: 0 0 0 1px #000, 0 0 12px rgba(125, 211, 252, 0.6);
      border-radius: 2px;
    }}
    .slider::-moz-range-thumb {{
      width: 6px; height: 100%;
      background: var(--accent);
      border: none;
      box-shadow: 0 0 0 1px #000, 0 0 12px rgba(125, 211, 252, 0.6);
      border-radius: 2px;
    }}
    img.gain {{
      width: 100%;
      height: auto;
      display: block;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #05070c;
    }}
  </style>
</head>
<body>
  <h1>Ultra HDR sample {SAMPLE_ID}</h1>
  <p>Slider compares SDR base (left) vs HDR (gain applied, right). Gain map preview below. Exposure shift uses <code>clip((im*(2**ev))*255,0,255)</code> with EV={EV_BOOST:+.2f}. Built by Python + TensorFlow; no external assets.</p>
  <div class="shell">
    <div class="card">
      <div class="compare">
        <img class="layer" src="data:image/png;base64,{b64(BASE_PATH)}" alt="SDR base">
        <img id="hdr" class="layer boosted" src="data:image/png;base64,{b64(HDR_PATH)}" alt="HDR gain applied">
        <input id="slider" class="slider" type="range" min="0" max="100" value="50" aria-label="Reveal HDR gain">
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Gain map preview</h3>
      <img class="gain" src="data:image/png;base64,{b64(GAIN_PATH)}" alt="Gain map">
    </div>
  </div>
  <script>
    const hdr = document.getElementById('hdr');
    const slider = document.getElementById('slider');
    function update() {{
      const pct = 100 - Number(slider.value);
      hdr.style.clipPath = `inset(0 ${{pct}}% 0 0)`;
    }}
    slider.addEventListener('input', update);
    update();
  </script>
</body>
</html>
"""
    VIEW_PATH.write_text(view_html, encoding="utf-8")
    print(f"Wrote standalone HTML: {VIEW_PATH.relative_to(REPO_ROOT)}")


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
    build_images()
    serve()
