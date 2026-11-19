/* Neon Shore Cover Studio — editor wiring.
   Classic script; cover.js above it defines the renderer globals.
   Uploads stay on the machine (FileReader / object URLs only). */
'use strict';

const state = defaultCoverState();
const loadedPhotos = []; // HTMLImageElement per slot, index matches panel.photo
const historyStack = [];
let historyIndex = -1;
let previewScale = 1;

const $ = (id) => document.getElementById(id);
const previewCanvas = $('preview');
const shotCanvas = $('shotCanvas');
const editorRoot = $('editor');
const shotStage = $('shotStage');

/* ---------------------------------------------------------------- photos */

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not read ' + file.name));
    img.src = url;
  });
}

function loadSamplePhoto(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('sample photo not found: ' + name));
    img.src = 'samples/' + name + '.jpg';
  });
}

function assignPhotoToAllPanels(index) {
  for (const panel of state.panels) panel.photo = index;
}

function refreshPhotoTray() {
  const tray = $('photoTray');
  tray.innerHTML = '';
  loadedPhotos.forEach((img, index) => {
    const button = document.createElement('button');
    button.className = 'tray-thumb';
    button.type = 'button';
    button.title = 'Photo ' + (index + 1) + ' — click: use for the selected panel';
    const thumb = document.createElement('img');
    thumb.src = img.src;
    thumb.alt = 'Photo ' + (index + 1);
    button.appendChild(thumb);
    const label = document.createElement('span');
    label.textContent = 'Photo ' + (index + 1);
    button.appendChild(label);
    button.addEventListener('click', () => {
      state.panels[state.selected].photo = index;
      pushHistory();
      renderPreview();
      refreshPanelList();
    });
    tray.appendChild(button);
  });
  if (loadedPhotos.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tray-empty';
    empty.textContent = 'No photos yet — upload one, or load a sample.';
    tray.appendChild(empty);
  }
  $('fillAllBtn').disabled = loadedPhotos.length === 0;
}

async function addUploadedFiles(files) {
  for (const file of files) {
    if (!file.type || !file.type.startsWith('image/')) continue;
    try {
      const img = await loadImageFromFile(file);
      const index = loadedPhotos.length;
      loadedPhotos.push(img);
      if (loadedPhotos.length === 1) assignPhotoToAllPanels(index);
    } catch (err) {
      showStatus('Could not read ' + file.name);
    }
  }
  refreshPhotoTray();
  renderPreview();
  refreshPanelList();
}

async function loadSamplePhotos(names) {
  for (const name of names) {
    try {
      const img = await loadSamplePhoto(name);
      loadedPhotos.push(img);
    } catch (err) {
      showStatus('Sample photo missing: ' + name);
    }
  }
  if (loadedPhotos.length > 0) assignPhotoToAllPanels(0);
  refreshPhotoTray();
  renderPreview();
  refreshPanelList();
}

/* ---------------------------------------------------------------- render */

function currentSize() {
  return COVER_SIZES[state.size] || COVER_SIZES['1920x1080'];
}

function renderPreview() {
  const [W, H] = currentSize();
  const maxW = 880;
  const scale = Math.min(1, maxW / W);
  previewScale = scale;
  previewCanvas.width = Math.round(W * scale);
  previewCanvas.height = Math.round(H * scale);
  const rendered = renderCover(state, loadedPhotos, previewCanvas.width, previewCanvas.height);
  const ctx = previewCanvas.getContext('2d');
  ctx.drawImage(rendered, 0, 0);
  $('sizeLabel').textContent = state.size.replace('x', ' × ') + ' px';
  // Highlight the selected panel.
  const rects = panelRects(state, previewCanvas.width, previewCanvas.height);
  const rect = rects[state.selected];
  if (rect) {
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    ctx.restore();
  }
}

function renderShotCover() {
  const [W, H] = currentSize();
  shotCanvas.width = W;
  shotCanvas.height = H;
  const rendered = renderCover(state, loadedPhotos, W, H);
  const ctx = shotCanvas.getContext('2d');
  ctx.drawImage(rendered, 0, 0);
}

/* ---------------------------------------------------------------- history */

function pushHistory() {
  const snapshot = serializeCoverState(state);
  historyStack.splice(historyIndex + 1);
  historyStack.push(snapshot);
  if (historyStack.length > 60) historyStack.shift();
  historyIndex = historyStack.length - 1;
  updateUndoRedoButtons();
}

function applyHistory(index) {
  if (index < 0 || index >= historyStack.length) return;
  historyIndex = index;
  restoreCoverState(state, historyStack[historyIndex]);
  syncControls();
  renderPreview();
  refreshPanelList();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  $('undoBtn').disabled = historyIndex <= 0;
  $('redoBtn').disabled = historyIndex >= historyStack.length - 1;
}

/* ---------------------------------------------------------------- controls */

function syncControls() {
  $('titleInput').value = state.title;
  $('subtitleInput').value = state.subtitle;
  $('badgeInput').value = state.badge;
  $('heatInput').value = String(state.heat);
  document.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === state.layout);
  });
  document.querySelectorAll('[data-grade]').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === state.grade);
  });
  document.querySelectorAll('[data-size]').forEach((b) => {
    b.classList.toggle('active', b.dataset.size === state.size);
  });
  const panel = state.panels[state.selected];
  $('zoomInput').value = String(panel.zoom);
  $('zoomValue').textContent = Math.round(panel.zoom * 100) + '%';
  $('selectedPanelLabel').textContent = 'Panel ' + (state.selected + 1) + ' of ' + layoutPanelCount(state.layout);
}

function refreshPanelList() {
  const list = $('panelList');
  list.innerHTML = '';
  const count = layoutPanelCount(state.layout);
  for (let i = 0; i < count; i++) {
    const panel = state.panels[i];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-chip' + (i === state.selected ? ' active' : '');
    button.textContent = 'Panel ' + (i + 1) + ' · Photo ' + (panel.photo + 1);
    button.addEventListener('click', () => {
      state.selected = i;
      pushHistory();
      syncControls();
      renderPreview();
      refreshPanelList();
    });
    list.appendChild(button);
  }
  syncControls();
}

function showStatus(message) {
  $('statusLine').textContent = message;
}

/* ---------------------------------------------------------------- export */

function downloadCanvas(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        showStatus('Export failed — the canvas was empty.');
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      resolve(true);
    }, 'image/png');
  });
}

async function exportCover(sizeId) {
  const [W, H] = COVER_SIZES[sizeId];
  const rendered = renderCover(state, loadedPhotos, W, H);
  const ok = await downloadCanvas(rendered, 'neon-shore-cover-' + sizeId + '.png');
  if (ok) showStatus('Exported ' + sizeId + ' PNG — check your downloads.');
  return ok;
}

async function exportAllSizes() {
  for (const sizeId of Object.keys(COVER_SIZES)) {
    await exportCover(sizeId);
    await new Promise((r) => setTimeout(r, 250));
  }
  showStatus('Exported all three sizes as PNG.');
}

/* ---------------------------------------------------------------- dragging */

function canvasPoint(event) {
  const rect = previewCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * previewCanvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * previewCanvas.height;
  return { x, y };
}

let dragPanel = -1;
let dragLast = null;

previewCanvas.addEventListener('pointerdown', (event) => {
  const point = canvasPoint(event);
  const hit = hitTestPanel(state, previewCanvas.width, previewCanvas.height, point.x, point.y);
  if (hit < 0) return;
  state.selected = hit;
  dragPanel = hit;
  dragLast = point;
  previewCanvas.setPointerCapture(event.pointerId);
  syncControls();
  renderPreview();
  refreshPanelList();
});

previewCanvas.addEventListener('pointermove', (event) => {
  if (dragPanel < 0 || !dragLast) return;
  const point = canvasPoint(event);
  const panel = state.panels[dragPanel];
  const rects = panelRects(state, previewCanvas.width, previewCanvas.height);
  const rect = rects[dragPanel];
  if (!rect) return;
  // Panning moves the photo the opposite way to the drag, like a crop tool.
  panel.ox = Math.max(-0.6, Math.min(0.6, panel.ox - (point.x - dragLast.x) / rect.w));
  panel.oy = Math.max(-0.6, Math.min(0.6, panel.oy - (point.y - dragLast.y) / rect.h));
  dragLast = point;
  renderPreview();
});

function endDrag() {
  if (dragPanel >= 0) {
    dragPanel = -1;
    dragLast = null;
    pushHistory();
  }
}
previewCanvas.addEventListener('pointerup', endDrag);
previewCanvas.addEventListener('pointercancel', endDrag);

/* ---------------------------------------------------------------- wiring */

function buildPickerButtons() {
  const layoutRow = $('layoutRow');
  for (const id of COVER_LAYOUT_IDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.layout = id;
    button.textContent = COVER_LAYOUT_LABELS[id];
    button.addEventListener('click', () => {
      state.layout = id;
      if (state.selected >= layoutPanelCount(id)) state.selected = 0;
      pushHistory();
      syncControls();
      renderPreview();
      refreshPanelList();
    });
    layoutRow.appendChild(button);
  }
  const gradeRow = $('gradeRow');
  for (const id of Object.keys(COVER_GRADES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.grade = id;
    button.textContent = COVER_GRADES[id].label;
    button.addEventListener('click', () => {
      state.grade = id;
      pushHistory();
      syncControls();
      renderPreview();
    });
    gradeRow.appendChild(button);
  }
  const sizeRow = $('sizeRow');
  for (const id of Object.keys(COVER_SIZES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.size = id;
    button.textContent = id.replace('x', ' × ');
    button.addEventListener('click', () => {
      state.size = id;
      pushHistory();
      syncControls();
      renderPreview();
    });
    sizeRow.appendChild(button);
  }
}

function wireEditor() {
  buildPickerButtons();

  $('photoInput').addEventListener('change', (event) => {
    addUploadedFiles(Array.from(event.target.files || []));
    event.target.value = '';
  });
  $('sampleBtn').addEventListener('click', () => loadSamplePhotos(['boulevard', 'pier']));
  $('fillAllBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    assignPhotoToAllPanels(panel.photo);
    pushHistory();
    renderPreview();
    refreshPanelList();
    showStatus('Photo ' + (panel.photo + 1) + ' now fills every panel.');
  });

  let titleTimer = null;
  $('titleInput').addEventListener('input', (event) => {
    state.title = event.target.value;
    renderPreview();
    clearTimeout(titleTimer);
    titleTimer = setTimeout(pushHistory, 500);
  });
  let subtitleTimer = null;
  $('subtitleInput').addEventListener('input', (event) => {
    state.subtitle = event.target.value;
    renderPreview();
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(pushHistory, 500);
  });
  $('badgeInput').addEventListener('input', (event) => {
    state.badge = event.target.value;
    renderPreview();
    pushHistory();
  });
  $('heatInput').addEventListener('input', (event) => {
    state.heat = Math.max(0, Math.min(5, Number(event.target.value) || 0));
    renderPreview();
  });
  $('heatInput').addEventListener('change', pushHistory);

  $('zoomInput').addEventListener('input', (event) => {
    state.panels[state.selected].zoom = Number(event.target.value);
    $('zoomValue').textContent = Math.round(state.panels[state.selected].zoom * 100) + '%';
    renderPreview();
  });
  $('zoomInput').addEventListener('change', pushHistory);
  $('zoomOutBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    panel.zoom = Math.max(1, +(panel.zoom - 0.1).toFixed(2));
    pushHistory();
    syncControls();
    renderPreview();
  });
  $('zoomInBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    panel.zoom = Math.min(3, +(panel.zoom + 0.1).toFixed(2));
    pushHistory();
    syncControls();
    renderPreview();
  });
  $('resetPanBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    panel.ox = 0;
    panel.oy = 0;
    panel.zoom = 1;
    pushHistory();
    syncControls();
    renderPreview();
  });

  $('undoBtn').addEventListener('click', () => applyHistory(historyIndex - 1));
  $('redoBtn').addEventListener('click', () => applyHistory(historyIndex + 1));
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      applyHistory(historyIndex - 1);
    } else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault();
      applyHistory(historyIndex + 1);
    }
  });

  document.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', () => exportCover(button.dataset.export));
  });
  $('exportAllBtn').addEventListener('click', exportAllSizes);

  // Drag-and-drop photos straight onto the preview.
  previewCanvas.addEventListener('dragover', (event) => event.preventDefault());
  previewCanvas.addEventListener('drop', (event) => {
    event.preventDefault();
    addUploadedFiles(Array.from(event.dataTransfer.files || []));
  });
}

/* ---------------------------------------------------------------- ?shot= */

async function waitForCoverFonts() {
  try {
    await Promise.all([
      document.fonts.load('100px Anton'),
      document.fonts.load('40px Pacifico'),
    ]);
    await document.fonts.ready;
  } catch (err) {
    // Fallback fonts still render; the cover stays usable.
  }
}

function applyShotParams(params) {
  const photo = params.get('photo');
  const caption = params.get('caption');
  const subtitle = params.get('subtitle');
  const layout = params.get('layout');
  const grade = params.get('grade');
  const size = params.get('size');
  if (caption) state.title = caption;
  if (subtitle) state.subtitle = subtitle;
  if (layout && COVER_LAYOUT_IDS.includes(layout)) state.layout = layout;
  if (grade && COVER_GRADES[grade]) state.grade = grade;
  if (size && COVER_SIZES[size]) state.size = size;
  return photo;
}

async function runShotScene() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (!shot) return false;
  const photo = applyShotParams(params);
  wireEditor();
  if (photo) {
    try {
      const img = await loadSamplePhoto(photo);
      loadedPhotos.push(img);
      assignPhotoToAllPanels(0);
    } catch (err) {
      showStatus('Sample photo missing: ' + photo);
    }
  } else {
    await loadSamplePhotos(['boulevard', 'pier']);
  }
  await waitForCoverFonts();
  refreshPhotoTray();
  syncControls();
  refreshPanelList();
  if (shot === 'cover') {
    editorRoot.classList.add('hidden');
    document.querySelector('.topbar').classList.add('hidden');
    shotStage.classList.remove('hidden');
    renderShotCover();
    // Fit the export canvas into the viewport for the screenshot.
    const [W, H] = currentSize();
    const fit = Math.min(window.innerWidth / W, window.innerHeight / H, 1);
    shotCanvas.style.width = Math.round(W * fit) + 'px';
    shotCanvas.style.height = Math.round(H * fit) + 'px';
  } else {
    renderPreview();
  }
  showStatus('Sample photo loaded — drag a panel to pan, pick a layout, export a PNG.');
  pushHistory();
  window.__shotReady = true;
  return true;
}

/* ---------------------------------------------------------------- boot */

async function bootEditor() {
  if (await runShotScene()) return;
  wireEditor();
  await waitForCoverFonts();
  refreshPhotoTray();
  syncControls();
  refreshPanelList();
  renderPreview();
  pushHistory();
  showStatus('Ready — upload a photo or load a sample, pick a layout, export a PNG.');
}

document.addEventListener('DOMContentLoaded', bootEditor);
