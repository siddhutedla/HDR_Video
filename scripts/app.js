const gainShell = document.getElementById('gainShell');
const gainBase = document.getElementById('gainBase');
const gainBoost = document.getElementById('gainBoost');
const gainSlider = document.getElementById('gainSlider');
const gainFileInfo = document.getElementById('gainFileInfo');
const gainNote = document.getElementById('gainNote');
const resetGain = document.getElementById('resetGain');
const enableGain = document.getElementById('enableGain');
const hdrSupportChip = document.getElementById('hdr-support');
const gamutChip = document.getElementById('gamut');

const BUNDLED_JPG = './assets/Triad-gain-map.jpg';
let currentImage = null;
let currentBuffer = null;

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

// Load bundled gain-map sample on page load
loadGainMapSample();

async function loadGainMapSample() {
  gainNote.textContent = 'Loading bundled gain-map JPEG…';
  await loadGainJpg(BUNDLED_JPG, 'Triad-gain-map.jpg');
}

async function loadGainJpg(src, name) {
  try {
    const { img, buffer } = await loadImage(src);
    currentImage = img;
    currentBuffer = buffer;
    renderGainCanvases(img);
    const hasGain = buffer ? detectGainMap(buffer) : false;
    const gainText = hasGain ? 'gain map metadata detected' : 'no gain map metadata found';
    gainFileInfo.textContent = `${name} — ${img.width}×${img.height} (${gainText})`;
    gainNote.textContent = 'Drag the slider to compare. Toggle gain to switch the boost on/off.';
  } catch (err) {
    console.error('Gain map load failed', err);
    gainNote.textContent = `Could not load JPG (${err.message}).`;
  }
}

function loadImage(urlOrFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ img, buffer: null });
    img.onerror = reject;
    if (urlOrFile instanceof File) {
      img.src = URL.createObjectURL(urlOrFile);
    } else {
      fetch(urlOrFile)
        .then((r) => r.arrayBuffer())
        .then((buffer) => {
          const blob = new Blob([buffer], { type: 'image/jpeg' });
          img.src = URL.createObjectURL(blob);
          img.onload = () => resolve({ img, buffer });
        })
        .catch(reject);
    }
  });
}

function renderGainCanvases(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  gainShell.style.setProperty('--aspect', `${width} / ${height}`);

  [gainBase, gainBoost].forEach((c) => {
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
  });

  if (enableGain.checked) {
    applyGain();
    gainBoost.style.opacity = 1;
  } else {
    gainBoost.style.opacity = 0;
  }

  // Reset slider
  gainSlider.value = 50;
  updateGainClip();
}

function applyGain() {
  // TensorFlow.js pass: simple exposure/gain boost in linear space
  const tfImage = tf.browser.fromPixels(gainBoost);
  const linear = tfImage.div(255).pow(2.2);
  const boosted = linear.mul(2.8).clipByValue(0, 1); // stronger so toggle is obvious
  const srgb = boosted.pow(1 / 2.2).mul(255).clipByValue(0, 255);
  tf.browser.toPixels(srgb, gainBoost);
  tfImage.dispose();
  linear.dispose();
  boosted.dispose();
  srgb.dispose();
}

function updateGainClip() {
  const val = Number(gainSlider.value);
  const percent = 100 - val;
  // Clip right side of boosted layer to reveal base
  gainBoost.style.clipPath = `inset(0 ${percent}% 0 0)`;
}

gainSlider.addEventListener('input', updateGainClip);

enableGain.addEventListener('change', () => {
  if (!currentImage) return;
  renderGainCanvases(currentImage);
});

resetGain.addEventListener('click', () => {
  loadGainMapSample();
});

function detectGainMap(buffer) {
  // Heuristic: search for common UltraHDR gain map markers
  const haystack = new Uint8Array(buffer);
  const needles = ['HDRGM', 'GainMap', 'GMap', 'Ghdr'];
  return needles.some((word) => findAscii(haystack, word));
}

function findAscii(bytes, text) {
  const target = Array.from(text).map((ch) => ch.charCodeAt(0));
  for (let i = 0; i <= bytes.length - target.length; i++) {
    let match = true;
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
