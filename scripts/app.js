const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const imageShell = document.getElementById('imageShell');
const imageCanvas = document.getElementById('imageCanvas');
const hdrFileInfo = document.getElementById('hdrFileInfo');
const hdrNote = document.getElementById('hdrNote');
const hdrSupportChip = document.getElementById('hdr-support');
const gamutChip = document.getElementById('gamut');

// Legacy video elements kept for potential future use
const playerShell = document.getElementById('playerShell');
const player = document.getElementById('player');
const fileInfo = document.getElementById('fileInfo');
const capabilityNote = document.getElementById('capabilityNote');

const ALLOWED_FILE = 'HDR_041_Path_Ref.hdr';
const BUNDLED_PATH = `./assets/${ALLOWED_FILE}`;

// Restrict picker to .hdr only
fileInput.setAttribute('accept', '.hdr');

// Capability detection (approximate; depends on browser + GPU + display)
function detectHDR() {
  const isHDR = window.matchMedia && window.matchMedia('(color-gamut: p3)').matches;
  const isRec2020 = window.matchMedia && window.matchMedia('(color-gamut: rec2020)').matches;

  hdrSupportChip.textContent = isHDR ? 'HDR capable display detected' : 'No wide-gamut display detected';
  hdrSupportChip.style.background = isHDR ? 'rgba(34,197,94,0.16)' : 'rgba(248,113,113,0.16)';
  hdrSupportChip.style.borderColor = isHDR ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.35)';

  gamutChip.textContent = isRec2020 ? 'Gamut: Rec.2020 (likely HDR)' : isHDR ? 'Gamut: Display P3' : 'Gamut: sRGB only';
}

detectHDR();

// Auto-load bundled HDR file on page load
fetchHDR(BUNDLED_PATH, ALLOWED_FILE);

// Handle file selection
fileInput.addEventListener('change', (evt) => {
  const file = evt.target.files?.[0];
  if (file) handleFile(file);
});

// Drag-drop support
['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.borderColor = 'var(--accent)';
  });
});
['dragleave', 'drop'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.borderColor = 'rgba(255,255,255,0.18)';
  });
});
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

dropzone.addEventListener('click', () => fileInput.click());

function handleFile(file) {
  if (file.name !== ALLOWED_FILE) {
    showError(`Only ${ALLOWED_FILE} is permitted.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => renderHDR(reader.result, file.name);
  reader.onerror = () => showError('Failed to read the HDR file.');
  reader.readAsArrayBuffer(file);
}

async function fetchHDR(url, name) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    renderHDR(buffer, name, true);
  } catch (err) {
    showError(`Could not load bundled HDR (${err.message}). Try dropping the local copy.`);
  }
}

function showError(msg) {
  imageShell.hidden = false;
  hdrFileInfo.textContent = '';
  hdrNote.textContent = msg;
  imageCanvas.width = 0;
  imageCanvas.height = 0;
}

function renderHDR(arrayBuffer, name, fromBundle = false) {
  const t0 = performance.now();
  const hdr = parseRadianceHDR(arrayBuffer);
  const { width, height, data } = hdr; // data: Float32Array RGB

  imageCanvas.width = width;
  imageCanvas.height = height;
  const ctx = imageCanvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const out = imgData.data;

  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    out[j]     = toSRGB(tonemapACES(r)) * 255;
    out[j + 1] = toSRGB(tonemapACES(g)) * 255;
    out[j + 2] = toSRGB(tonemapACES(b)) * 255;
    out[j + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  imageShell.hidden = false;

  const mb = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
  hdrFileInfo.textContent = `${name} — ${width}×${height}, ${mb} MB`;
  hdrNote.textContent = fromBundle ? 'Loaded bundled sample HDR file.' : 'Loaded local HDR file.';
  console.log(`Rendered HDR in ${(performance.now() - t0).toFixed(1)} ms`);

  // Hide legacy video shell
  playerShell.hidden = true;
}

// Simple ACES-like tone mapper
function tonemapACES(x) {
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

// Gamma to sRGB-ish
function toSRGB(x) {
  const clamped = Math.min(1, Math.max(0, x));
  return Math.pow(clamped, 1 / 2.2);
}

// Radiance HDR (RGBE, RLE) parser
function parseRadianceHDR(buffer) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const decoder = new TextDecoder();

  const readLine = () => {
    let start = offset;
    while (offset < bytes.length && bytes[offset] !== 0x0a) offset++;
    const line = decoder.decode(bytes.subarray(start, offset));
    offset++; // skip newline
    return line.trim();
  };

  const magic = readLine();
  if (!magic.startsWith('#?RADIANCE') && !magic.startsWith('#?RGBE')) {
    throw new Error('Not a Radiance HDR file');
  }

  let format = '';
  while (true) {
    const line = readLine();
    if (!line) break;
    if (line.startsWith('FORMAT=')) format = line.split('=')[1];
  }
  if (format !== '32-bit_rle_rgbe') throw new Error(`Unsupported format: ${format}`);

  const resLine = readLine();
  let width, height;
  const tokens = resLine.trim().split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    const val = parseInt(tokens[i + 1], 10);
    if (Number.isNaN(val)) continue;
    if (tokens[i].toUpperCase().includes('X')) width = val;
    if (tokens[i].toUpperCase().includes('Y')) height = val;
  }
  if (!width || !height) {
    const nums = resLine.match(/-?\\d+/g) || [];
    if (nums.length >= 2) {
      // Fallback: assume order Y then X as common case
      height = height || parseInt(nums[0], 10);
      width = width || parseInt(nums[1], 10);
    }
  }
  if (!width || !height) {
    const bytesAround = Array.from(bytes.subarray(Math.max(0, offset - 64), Math.min(bytes.length, offset + 64)));
    console.warn('Unexpected resolution line, raw bytes context:', bytesAround, 'line:', resLine);
    throw new Error(`Unexpected resolution line: \"${resLine}\"`);
  }

  const numPixels = width * height;
  const data = new Float32Array(numPixels * 3);
  const scanline = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    if (bytes[offset] !== 2 || bytes[offset + 1] !== 2) {
      throw new Error('Unsupported scanline format');
    }
    const scanWidth = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (scanWidth !== width) throw new Error('Scanline width mismatch');
    offset += 4;

    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < width) {
        const val = bytes[offset++];
        if (val > 128) {
          const count = val - 128;
          const rep = bytes[offset++];
          for (let i = 0; i < count; i++) scanline[c * width + x++] = rep;
        } else {
          let count = val;
          for (let i = 0; i < count; i++) scanline[c * width + x++] = bytes[offset++];
        }
      }
    }

    for (let x = 0; x < width; x++) {
      const r = scanline[x];
      const g = scanline[width + x];
      const b = scanline[2 * width + x];
      const e = scanline[3 * width + x];

      if (e === 0) {
        data[(y * width + x) * 3 + 0] = 0;
        data[(y * width + x) * 3 + 1] = 0;
        data[(y * width + x) * 3 + 2] = 0;
      } else {
        const f = Math.pow(2, e - 128) / 256;
        data[(y * width + x) * 3 + 0] = r * f;
        data[(y * width + x) * 3 + 1] = g * f;
        data[(y * width + x) * 3 + 2] = b * f;
      }
    }
  }

  return { width, height, data };
}
