/* Neon Shore Cover Studio — cover renderer.
   Vanilla Canvas 2D. No network, no libraries. Every drawing decision lives
   here so the editor (main.js) only wires controls to state. */
'use strict';

/* ---------------------------------------------------------------- sizes */

const COVER_SIZES = {
  '1080x1080': [1080, 1080],
  '1080x1350': [1080, 1350],
  '1920x1080': [1920, 1080],
};

const COVER_LAYOUT_IDS = ['grid4', 'hero3', 'single', 'grid9', 'strip', 'story'];

const COVER_LAYOUT_LABELS = {
  grid4: '4-panel grid',
  hero3: 'Hero + 3',
  single: 'Full-bleed single',
  grid9: '9-panel grid',
  strip: 'Tilted snapshot strip',
  story: 'Story / portrait',
};

/** How many photo panels a layout shows. */
function layoutPanelCount(layout) {
  if (layout === 'single') return 1;
  if (layout === 'grid9') return 8;
  if (layout === 'story') return 3;
  return 4;
}

/* ---------------------------------------------------------------- state */

function defaultCoverState() {
  const panels = [];
  for (let i = 0; i < 8; i++) panels.push({ photo: 0, zoom: 1, ox: 0, oy: 0 });
  return {
    title: 'SUNSET HEIST',
    subtitle: 'Neon Shore nights',
    layout: 'hero3',
    grade: 'sunset',
    size: '1920x1080',
    badge: 'EST. 2026',
    heat: 4,
    seed: 20261119,
    selected: 0,
    panels,
  };
}

/** A JSON-safe copy of the editable state (photos live outside it). */
function serializeCoverState(state) {
  return JSON.parse(JSON.stringify({
    title: state.title,
    subtitle: state.subtitle,
    layout: state.layout,
    grade: state.grade,
    size: state.size,
    badge: state.badge,
    heat: state.heat,
    seed: state.seed,
    selected: state.selected,
    panels: state.panels,
  }));
}

function restoreCoverState(state, snapshot) {
  state.title = snapshot.title;
  state.subtitle = snapshot.subtitle;
  state.layout = snapshot.layout;
  state.grade = snapshot.grade;
  state.size = snapshot.size;
  state.badge = snapshot.badge;
  state.heat = snapshot.heat;
  state.seed = snapshot.seed;
  state.selected = snapshot.selected;
  state.panels = snapshot.panels.map((p) => ({ photo: p.photo, zoom: p.zoom, ox: p.ox, oy: p.oy }));
}

/* ---------------------------------------------------------------- grades */

/* A grade is a gradient map: the pixel luminance picks a colour off a ramp,
   blended back into the original, then a channel mix and a contrast lift.
   Implemented with per-channel lookup tables over ImageData — never CSS. */
const COVER_GRADES = {
  sunset: {
    label: 'Sunset',
    strength: 0.55,
    stops: [[0, '#1a0b2e'], [0.35, '#7a1e4d'], [0.65, '#e8442e'], [0.85, '#ff7a3d'], [1, '#ffd98a']],
    gain: [1.06, 0.98, 0.94],
    contrast: 1.08,
  },
  neon: {
    label: 'Neon',
    strength: 0.6,
    stops: [[0, '#05021a'], [0.3, '#3b0a6e'], [0.6, '#d6339c'], [0.8, '#22d3ee'], [1, '#d8fbff']],
    gain: [1.02, 0.98, 1.08],
    contrast: 1.1,
  },
  vice: {
    label: 'Vice',
    strength: 0.55,
    stops: [[0, '#12041f'], [0.35, '#5b2a86'], [0.65, '#8b5cf6'], [0.85, '#2dd4bf'], [1, '#e0fff8']],
    gain: [1.04, 0.96, 1.06],
    contrast: 1.07,
  },
  golden: {
    label: 'Golden Hour',
    strength: 0.5,
    stops: [[0, '#241303'], [0.35, '#7a4a12'], [0.65, '#d98a1f'], [0.85, '#f5b942'], [1, '#fff3c4']],
    gain: [1.08, 1.0, 0.9],
    contrast: 1.06,
  },
  noir: {
    label: 'Noir',
    strength: 0.85,
    stops: [[0, '#0a0705'], [0.4, '#4a3f36'], [0.75, '#a89a8a'], [1, '#fff1dd']],
    gain: [1.05, 1.0, 0.96],
    contrast: 1.18,
  },
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function sampleGradeRamp(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / Math.max(0.0001, t1 - t0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

/** Build per-channel 256-entry lookup tables for a grade id. */
function gradeLookupTables(gradeId) {
  const grade = COVER_GRADES[gradeId] || COVER_GRADES.sunset;
  const tables = [[], [], []];
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    const ramp = sampleGradeRamp(grade.stops, t);
    for (let c = 0; c < 3; c++) {
      let out = v + (ramp[c] - v) * grade.strength;
      out = (out - 128) * grade.contrast + 128;
      out *= grade.gain[c];
      tables[c].push(Math.max(0, Math.min(255, Math.round(out))));
    }
  }
  return tables;
}

/** Apply a grade's gradient map to a whole canvas, in place. */
function applyGradeToCanvas(canvas, gradeId) {
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const tables = gradeLookupTables(gradeId);
  const rT = tables[0];
  const gT = tables[1];
  const bT = tables[2];
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    // The ramp is keyed on luminance, the mix keeps the photo's own detail.
    data[i] = rT[lum];
    data[i + 1] = gT[lum];
    data[i + 2] = bT[lum];
  }
  ctx.putImageData(image, 0, 0);
}

/* ---------------------------------------------------------------- helpers */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function coverFitScale(imgW, imgH, rectW, rectH) {
  return Math.max(rectW / imgW, rectH / imgH);
}

/** Draw one photo into a rect, cover-fit, with the panel's pan/zoom. */
function drawPanelPhoto(ctx, img, rect, pan) {
  const scale = coverFitScale(img.width, img.height, rect.w, rect.h) * pan.zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = rect.x + (rect.w - dw) / 2 + pan.ox * rect.w;
  const dy = rect.y + (rect.h - dh) / 2 + pan.oy * rect.h;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** Placeholder art for an empty panel: sunset stripes + a prompt. */
function drawEmptyPanel(ctx, rect, label) {
  const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  grad.addColorStop(0, '#2b1055');
  grad.addColorStop(0.55, '#7597de');
  grad.addColorStop(1, '#ff7a3d');
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `700 ${Math.max(14, rect.w * 0.045)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

function drawStar(ctx, cx, cy, outerR, innerR, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (fill) ctx.fill();
  else ctx.stroke();
}

/* ---------------------------------------------------------------- geometry */

/* Every layout returns panel rects (fractions of the canvas), a title band
   rect, and whether the title band sits on top instead of the bottom. */
function layoutGeometry(layout, W, H) {
  const gutter = Math.round(Math.min(W, H) * 0.012);
  const titleH = Math.round(H * 0.24);
  const photoH = H - titleH - gutter;
  const full = { x: 0, y: 0, w: W, h: H };
  const band = { x: 0, y: H - titleH, w: W, h: titleH };
  if (layout === 'grid4') {
    const pw = (W - gutter * 3) / 2;
    const ph = (photoH - gutter) / 2;
    return {
      panels: [
        { x: gutter, y: gutter, w: pw, h: ph, rot: 0 },
        { x: gutter * 2 + pw, y: gutter, w: pw, h: ph, rot: 0 },
        { x: gutter, y: gutter * 2 + ph, w: pw, h: ph, rot: 0 },
        { x: gutter * 2 + pw, y: gutter * 2 + ph, w: pw, h: ph, rot: 0 },
      ],
      title: band,
      titleOnTop: false,
    };
  }
  if (layout === 'hero3') {
    const heroW = Math.round(W * 0.6);
    const sideX = heroW + gutter;
    const sideW = W - sideX - gutter;
    const sh = (photoH - gutter * 2) / 3;
    return {
      panels: [
        { x: gutter, y: gutter, w: heroW - gutter, h: photoH, rot: 0 },
        { x: sideX, y: gutter, w: sideW, h: sh, rot: 0 },
        { x: sideX, y: gutter * 2 + sh, w: sideW, h: sh, rot: 0 },
        { x: sideX, y: gutter * 3 + sh * 2, w: sideW, h: sh, rot: 0 },
      ],
      title: band,
      titleOnTop: false,
    };
  }
  if (layout === 'single') {
    return { panels: [{ x: 0, y: 0, w: W, h: photoH, rot: 0 }], title: band, titleOnTop: false };
  }
  if (layout === 'grid9') {
    // The centre cell is the title block, so the grid spans the full height.
    const cw = (W - gutter * 4) / 3;
    const ch = (H - gutter * 4) / 3;
    const panels = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue; // centre cell is the title block
        panels.push({
          x: gutter + col * (cw + gutter),
          y: gutter + row * (ch + gutter),
          w: cw,
          h: ch,
          rot: 0,
        });
      }
    }
    const centre = {
      x: gutter + cw + gutter,
      y: gutter + ch + gutter,
      w: cw,
      h: ch,
    };
    return { panels, title: centre, titleOnTop: false, titleIsCell: true };
  }
  if (layout === 'strip') {
    // Title band on top; the snapshots fill the space beneath it.
    const stripTitleH = Math.round(H * 0.16);
    const areaY = stripTitleH + gutter;
    const areaH = H - areaY - gutter;
    const pw = Math.round(W * 0.28);
    const ph = Math.round(areaH * 0.9);
    const top = areaY + Math.round((areaH - ph) / 2);
    const step = (W - pw - gutter * 2) / 3;
    const rots = [-0.07, 0.05, -0.045, 0.06];
    const panels = [];
    for (let i = 0; i < 4; i++) {
      panels.push({ x: gutter + i * step, y: top + (i % 2) * gutter * 2, w: pw, h: ph, rot: rots[i] });
    }
    return { panels, title: { x: 0, y: 0, w: W, h: stripTitleH }, titleOnTop: true };
  }
  // story: tall top panel, two side-by-side, title band at the bottom.
  const topH = Math.round(photoH * 0.58);
  const botH = photoH - topH - gutter;
  const halfW = (W - gutter * 3) / 2;
  return {
    panels: [
      { x: gutter, y: gutter, w: W - gutter * 2, h: topH, rot: 0 },
      { x: gutter, y: gutter * 2 + topH, w: halfW, h: botH, rot: 0 },
      { x: gutter * 2 + halfW, y: gutter * 2 + topH, w: halfW, h: botH, rot: 0 },
    ],
    title: band,
    titleOnTop: false,
  };
}

/* ---------------------------------------------------------------- drawing */

/** Draw the halftone dot texture inside a rect. */
function drawHalftoneDots(ctx, rect, rand, colour, maxR) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.fillStyle = colour;
  const step = Math.max(10, rect.h / 9);
  for (let y = rect.y + step / 2; y < rect.y + rect.h; y += step) {
    for (let x = rect.x + step / 2; x < rect.x + rect.w; x += step) {
      const edge = Math.min(x - rect.x, rect.x + rect.w - x) / rect.w;
      const r = Math.max(0.6, maxR * (0.35 + 0.65 * (1 - edge)) * (0.7 + rand() * 0.6));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Draw the title block: halftone, badge ribbon, heat stars, title + subtitle. */
function drawTitleBlock(ctx, state, rect, isCell, W) {
  const rand = mulberry32(state.seed + 7);
  // Solid ink band with a sunset wash on its top edge.
  const wash = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  wash.addColorStop(0, '#ff5e8a');
  wash.addColorStop(0.18, '#1a0b2e');
  wash.addColorStop(1, '#0d0716');
  ctx.fillStyle = wash;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  drawHalftoneDots(ctx, rect, rand, 'rgba(255,94,138,0.20)', Math.max(2, rect.h * 0.03));

  const pad = Math.max(14, rect.w * 0.04);
  const titleSize = isCell
    ? Math.min(rect.h * 0.34, rect.w * 0.16)
    : Math.min(rect.h * 0.52, rect.w * 0.085);
  const subSize = Math.max(13, titleSize * 0.34);

  // Badge ribbon, top-right of the band, anchored by its right edge so it
  // never runs past the band (the ribbon is 116 wide, centred on the anchor).
  const badgeText = state.badge || 'EST. 2026';
  ctx.save();
  ctx.translate(rect.x + rect.w - pad - 62, rect.y + pad + 6);
  ctx.rotate(0.06);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(-58, -13, 116, 26);
  ctx.fillStyle = '#14060f';
  ctx.font = `700 ${Math.max(11, titleSize * 0.22)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, 0, 1);
  ctx.restore();

  // Heat star meter, bottom-right.
  const starR = Math.max(7, titleSize * 0.14);
  const starY = rect.y + rect.h - pad * 0.9;
  const starGap = starR * 2.5;
  const starX0 = rect.x + rect.w - pad - starGap * 4;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < state.heat ? '#ffd23f' : 'rgba(255,255,255,0.25)';
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 1.5;
    drawStar(ctx, starX0 + i * starGap, starY, starR, starR * 0.45, i < state.heat);
    if (i >= state.heat) ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `700 ${Math.max(10, titleSize * 0.2)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('HEAT', starX0 - starR * 1.2, starY);

  // Main title: Anton, uppercase, tight tracking, dark outline, sunset fill.
  const title = (state.title || 'UNTITLED').toUpperCase();
  const titleY = rect.y + rect.h * (isCell ? 0.42 : 0.46);
  ctx.save();
  ctx.textAlign = isCell ? 'center' : 'left';
  ctx.textBaseline = 'middle';
  const titleX = isCell ? rect.x + rect.w / 2 : rect.x + pad;
  try { ctx.letterSpacing = '1px'; } catch (e) { /* older canvas: ignore */ }
  ctx.font = `${titleSize}px Anton, 'Arial Narrow', sans-serif`;
  // Shrink to fit the band when the caption runs long. A title cell has no
  // badge/stars beside the title, so it may use the cell's full width.
  const titleReserve = isCell ? 0 : 130;
  let fitSize = titleSize;
  while (fitSize > 16 && ctx.measureText(title).width > rect.w - pad * 2 - titleReserve) {
    fitSize *= 0.92;
    ctx.font = `${fitSize}px Anton, 'Arial Narrow', sans-serif`;
  }
  const fill = ctx.createLinearGradient(rect.x, titleY - fitSize * 0.6, rect.x, titleY + fitSize * 0.6);
  fill.addColorStop(0, '#fff7d6');
  fill.addColorStop(0.45, '#ffd23f');
  fill.addColorStop(1, '#ff5e3a');
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = fitSize * 0.18;
  ctx.shadowOffsetY = fitSize * 0.06;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#14060f';
  ctx.lineWidth = Math.max(2, fitSize * 0.09);
  ctx.strokeText(title, titleX, titleY);
  ctx.fillStyle = fill;
  ctx.fillText(title, titleX, titleY);
  ctx.restore();

  // Subtitle: Pacifico neon script.
  const subtitle = state.subtitle || '';
  if (subtitle) {
    ctx.save();
    ctx.textAlign = isCell ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    const subX = isCell ? rect.x + rect.w / 2 : rect.x + pad;
    const subY = titleY + fitSize * 0.72;
    ctx.font = `${subSize}px Pacifico, cursive`;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = subSize * 0.7;
    ctx.fillStyle = '#b8f6ff';
    ctx.fillText(subtitle, subX, subY);
    ctx.restore();
  }
}

/** Draw seeded grain over the whole canvas. */
function drawGrain(ctx, W, H, seed) {
  const rand = mulberry32(seed);
  const count = Math.round((W * H) / 900);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const v = rand();
    ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const s = 1 + Math.floor(rand() * 2);
    ctx.fillRect(rand() * W, rand() * H, s, s);
  }
  ctx.restore();
}

/** Draw a soft vignette over the whole canvas. */
function drawVignette(ctx, W, H) {
  const grad = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.42,
    W / 2, H / 2, Math.max(W, H) * 0.75,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(10,4,18,0.42)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Render the cover for a state into a fresh canvas at W x H.
 * photos: array of HTMLImageElement (or null); panel.photo indexes into it.
 */
function renderCover(state, photos, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const geo = layoutGeometry(state.layout, W, H);
  const gutter = Math.round(Math.min(W, H) * 0.012);

  // Backdrop.
  ctx.fillStyle = '#0b0714';
  ctx.fillRect(0, 0, W, H);

  // Panels: photos first (graded as one pass afterwards).
  const count = layoutPanelCount(state.layout);
  for (let i = 0; i < count; i++) {
    const rect = geo.panels[i];
    const pan = state.panels[i] || { photo: 0, zoom: 1, ox: 0, oy: 0 };
    const img = photos && photos[pan.photo] ? photos[pan.photo] : null;
    ctx.save();
    // Thick black gutter + white keyline around every panel.
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(rect.rot || 0);
    ctx.translate(-rect.w / 2, -rect.h / 2);
    ctx.beginPath();
    ctx.rect(0, 0, rect.w, rect.h);
    ctx.clip();
    if (img) drawPanelPhoto(ctx, img, { x: 0, y: 0, w: rect.w, h: rect.h }, pan);
    else drawEmptyPanel(ctx, { x: 0, y: 0, w: rect.w, h: rect.h }, 'ADD A PHOTO');
    ctx.restore();
    // Polaroid-style white frame for the tilted strip.
    if (state.layout === 'strip') {
      ctx.save();
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.rotate(rect.rot || 0);
      ctx.fillStyle = '#fdf6ec';
      ctx.fillRect(-rect.w / 2 - 7, -rect.h / 2 - 7, rect.w + 14, rect.h + 14);
      ctx.restore();
      // Re-draw the photo on top of the frame's middle (frame is a border).
      ctx.save();
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.rotate(rect.rot || 0);
      ctx.translate(-rect.w / 2, -rect.h / 2);
      ctx.beginPath();
      ctx.rect(0, 0, rect.w, rect.h);
      ctx.clip();
      if (img) drawPanelPhoto(ctx, img, { x: 0, y: 0, w: rect.w, h: rect.h }, pan);
      else drawEmptyPanel(ctx, { x: 0, y: 0, w: rect.w, h: rect.h }, 'ADD A PHOTO');
      ctx.restore();
    }
  }

  // Gradient-map grade over the photos (and backdrop) as one pass.
  applyGradeToCanvas(canvas, state.grade);

  // White keylines + drop shadows around panels.
  for (let i = 0; i < count; i++) {
    const rect = geo.panels[i];
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(rect.rot || 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(2, gutter * 0.35);
    ctx.strokeRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(3, gutter * 0.8);
    ctx.strokeRect(-rect.w / 2 - gutter * 0.4, -rect.h / 2 - gutter * 0.4, rect.w + gutter * 0.8, rect.h + gutter * 0.8);
    ctx.restore();
  }

  // Title block (drawn after the grade so the lettering stays crisp).
  drawTitleBlock(ctx, state, geo.title, !!geo.titleIsCell, W);

  // Effects.
  drawGrain(ctx, W, H, state.seed);
  drawVignette(ctx, W, H);
  return canvas;
}

/** Hit-test: which panel contains canvas point (px, py), or -1. */
function hitTestPanel(state, W, H, px, py) {
  const geo = layoutGeometry(state.layout, W, H);
  const count = layoutPanelCount(state.layout);
  for (let i = count - 1; i >= 0; i--) {
    const r = geo.panels[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return -1;
}

/** Panel rects in canvas pixels, for the editor overlay. */
function panelRects(state, W, H) {
  const geo = layoutGeometry(state.layout, W, H);
  return geo.panels.slice(0, layoutPanelCount(state.layout));
}
