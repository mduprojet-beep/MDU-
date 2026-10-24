import * as db from './js/db.js';
import { resize, photoUrl, forgetPhotoUrl } from './js/images.js';
import { speechSupported, createDictation } from './js/speech.js';
import { cameraSupported, startCamera, stopCamera, isLive, capture, cameraErrorMessage } from './js/camera.js';
import { COLORS, TOOLS, render as renderAnnotations, attachEditor } from './js/annotate.js';

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $camera = document.getElementById('camera-input');
const $gallery = document.getElementById('gallery-input');

// ---------- Réglages ----------
const settings = {
  get apiKey() { return safeGet('apiKey') || ''; },
  set apiKey(v) { safeSet('apiKey', v); },
  get model() { return safeGet('model') || null; },
  set model(v) { safeSet('model', v); },
};
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }

// Le module IA est chargé à la demande (il vient d'un CDN) pour que l'app
// s'ouvre même hors connexion.
let aiModule;
async function ai() {
  if (!aiModule) aiModule = await import('./js/ai.js');
  return aiModule;
}

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function setHeader(title, backHref) {
  $title.textContent = title;
  document.title = `${title} – Chantier Photo`;
  $back.hidden = !backHref;
  $back.onclick = () => { location.hash = backHref; };
}

// Ouvre l'appareil photo (ou la galerie) et renvoie les fichiers choisis.
function pickFiles(input) {
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

async function savePhoto(file, projectId, extra = {}) {
  const blob = await resize(file, 2000);
  const photo = { id: db.uid(), projectId, blob, caption: '', createdAt: Date.now(), ...extra };
  await db.put('photos', photo);
  return photo;
}

// Chaque vue renvoie éventuellement une fonction de nettoyage.
let cleanup = null;

// ---------- Routeur ----------
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  window.scrollTo(0, 0);
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (parts[0] === 'p' && parts[1] && parts[2] === 'camera') cleanup = await viewCamera(parts[1]);
    else if (parts[0] === 'p' && parts[1]) cleanup = await viewProject(parts[1]);
    else if (parts[0] === 'photo' && parts[1] && parts[2] === 'annotate') cleanup = await viewAnnotate(parts[1]);
    else if (parts[0] === 'photo' && parts[1]) cleanup = await viewPhoto(parts[1]);
    else if (parts[0] === 'w' && parts[1] && parts[2] === 'checklist') cleanup = await viewChecklist(parts[1]);
    else if (parts[0] === 'w' && parts[1]) cleanup = await viewWalkthrough(parts[1]);
    else if (parts[0] === 'settings') cleanup = await viewSettings();
    else cleanup = await viewHome();
  } catch (err) {
    console.error(err);
    $view.innerHTML = `<div class="card error">Erreur : ${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
document.getElementById('settings-btn').onclick = () => { location.hash = '#/settings'; };

// ---------- Accueil : liste des chantiers ----------
async function viewHome() {
  setHeader('Chantiers');
  const projects = (await db.all('projects')).sort((a, b) => b.createdAt - a.createdAt);
  $view.innerHTML = `
    <form id="new-project" class="card">
      <label for="np-name" style="margin-top:0">Nouveau chantier</label>
      <input id="np-name" type="text" placeholder="Nom (ex. Rénovation Dupont)" required>
      <input id="np-addr" type="text" placeholder="Adresse (facultatif)" style="margin-top:8px">
      <button class="btn primary block" style="margin-top:10px">Créer</button>
    </form>
    ${projects.length ? '' : '<p class="muted">Aucun chantier pour le moment.</p>'}
    ${projects.map((p) => `
      <a class="card list-item" href="#/p/${p.id}">
        <div class="grow"><strong>${esc(p.name)}</strong>
          <span class="muted">${esc(p.address || fmtDate(p.createdAt))}</span></div>
        <span class="chev">›</span>
      </a>`).join('')}
    ${settings.apiKey ? '' : `<div class="card notice"><strong>Pour le rapport IA</strong><br>
      <span class="muted">Ajoutez votre clé API Anthropic dans les réglages (⚙︎). Les photos et visites fonctionnent sans.</span></div>`}
  `;
  $view.querySelector('#new-project').onsubmit = async (e) => {
    e.preventDefault();
    const project = {
      id: db.uid(),
      name: $view.querySelector('#np-name').value.trim(),
      address: $view.querySelector('#np-addr').value.trim(),
      createdAt: Date.now(),
    };
    if (!project.name) return;
    await db.put('projects', project);
    db.requestPersistence();
    location.hash = `#/p/${project.id}`;
  };
}

// ---------- Projet ----------
async function viewProject(id) {
  const project = await db.get('projects', id);
  if (!project) { location.hash = '#/'; return; }
  setHeader(project.name, '#/');
  const photos = (await db.byProject('photos', id)).sort((a, b) => b.createdAt - a.createdAt);
  const walks = (await db.byProject('walkthroughs', id)).sort((a, b) => b.createdAt - a.createdAt);

  const walkLabel = (w) => w.report ? '<span class="badge ok">Rapport</span>'
    : w.status === 'recording' ? '<span class="badge rec">En cours</span>' : '<span class="badge">Brouillon</span>';

  $view.innerHTML = `
    <div class="card stack">
      <button id="start-walk" class="btn primary block">🎙️ Visite commentée IA</button>
      <div class="row">
        <button id="take" class="btn">📷 Photo</button>
        <button id="import" class="btn">🖼️ Importer</button>
      </div>
    </div>

    <div class="section-title"><h2>Visites</h2></div>
    ${walks.length ? walks.map((w) => `
      <a class="card list-item" href="#/w/${w.id}">
        <div class="grow"><strong>${esc(w.report?.titre || 'Visite du ' + fmtDate(w.createdAt))}</strong>
          <span class="muted">${fmtDate(w.createdAt)} · ${w.events.filter((e) => e.type === 'photo').length} photo(s)</span></div>
        ${walkLabel(w)}<span class="chev">›</span>
      </a>`).join('') : '<p class="muted">Aucune visite. Lancez une visite commentée : parlez en marchant, prenez des photos, l\'IA rédige le compte rendu.</p>'}

    <div class="section-title"><h2>Photos (${photos.length})</h2></div>
    <div class="grid">
      ${photos.map((p) => `<a href="#/photo/${p.id}"><img src="${photoUrl(p)}" alt="${esc(p.caption)}" loading="lazy"></a>`).join('')}
    </div>

    <div class="section-title"><h2>Chantier</h2></div>
    <div class="card">
      <label for="addr" style="margin-top:0">Adresse</label>
      <input id="addr" type="text" value="${esc(project.address)}">
      <button id="delete" class="btn danger block" style="margin-top:12px">Supprimer le chantier</button>
    </div>
  `;

  $view.querySelector('#start-walk').onclick = async () => {
    const walk = { id: db.uid(), projectId: id, createdAt: Date.now(), status: 'recording', elapsed: 0, events: [] };
    await db.put('walkthroughs', walk);
    location.hash = `#/w/${walk.id}`;
  };
  const addFrom = (input) => async () => {
    for (const f of await pickFiles(input)) await savePhoto(f, id);
    route();
  };
  $view.querySelector('#take').onclick = cameraSupported
    ? () => { location.hash = `#/p/${id}/camera`; }
    : addFrom($camera);
  $view.querySelector('#import').onclick = addFrom($gallery);
  $view.querySelector('#addr').onchange = async (e) => {
    project.address = e.target.value.trim();
    await db.put('projects', project);
  };
  $view.querySelector('#delete').onclick = async () => {
    if (!confirm(`Supprimer « ${project.name} » avec toutes ses photos et visites ? C'est définitif.`)) return;
    await db.deleteProject(id);
    location.hash = '#/';
  };
}

// ---------- Photo ----------
async function viewPhoto(id) {
  const photo = await db.get('photos', id);
  if (!photo) { history.back(); return; }
  setHeader('Photo', `#/p/${photo.projectId}`);
  $view.innerHTML = `
    <div class="photo-view"><img src="${photoUrl(photo)}" alt=""></div>
    <div class="card" style="margin-top:12px">
      <label for="cap" style="margin-top:0">Légende</label>
      <textarea id="cap" placeholder="Décrivez la photo (vous pouvez dicter avec le micro du clavier)">${esc(photo.caption)}</textarea>
      <p class="muted">${fmtDate(photo.createdAt)}${photo.annotations?.length ? ' · annotée' : ''}</p>
      <div class="stack">
        <a class="btn primary block" href="#/photo/${id}/annotate">✏️ Annoter</a>
        <button id="del" class="btn danger block">Supprimer la photo</button>
      </div>
    </div>`;
  $view.querySelector('#cap').onchange = async (e) => {
    photo.caption = e.target.value.trim();
    await db.put('photos', photo);
  };
  $view.querySelector('#del').onclick = async () => {
    if (!confirm('Supprimer cette photo ?')) return;
    await db.del('photos', id);
    location.hash = `#/p/${photo.projectId}`;
  };
}

// ---------- Appareil photo intégré ----------
// Affiche l'aperçu en direct dans `container`. take() prend la photo
// instantanément ; si l'aperçu est impossible, on retombe sur l'appareil
// photo d'iOS (avec son écran « Utiliser la photo »).
function mountCamera(container) {
  container.innerHTML = `
    <div class="cam">
      <video playsinline muted></video>
      <div class="flash"></div>
      <p class="cam-msg muted"></p>
    </div>`;
  const video = container.querySelector('video');
  const flash = container.querySelector('.flash');
  const msg = container.querySelector('.cam-msg');
  let stream = null;
  let stopped = false;

  async function open() {
    if (!cameraSupported || stopped) { msg.textContent = 'Aperçu indisponible : le bouton photo ouvrira l\'appareil photo de l\'iPhone.'; return; }
    try {
      msg.textContent = '';
      stream = await startCamera(video);
      if (stopped) stopCamera(stream);
    } catch (err) {
      stream = null;
      msg.textContent = cameraErrorMessage(err) + ' Le bouton photo ouvrira l\'appareil photo de l\'iPhone.';
    }
  }

  // iOS coupe la caméra quand l'app passe en arrière-plan : on la relance au retour.
  const onVisible = () => { if (document.visibilityState === 'visible' && !isLive(stream)) open(); };
  document.addEventListener('visibilitychange', onVisible);
  open();

  return {
    async take() {
      if (isLive(stream) && video.videoWidth) {
        flash.classList.remove('on');
        void flash.offsetWidth; // relance l'animation
        flash.classList.add('on');
        return [await capture(video)];
      }
      return pickFiles($camera);
    },
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      stopCamera(stream);
    },
  };
}

async function viewCamera(projectId) {
  const project = await db.get('projects', projectId);
  if (!project) { location.hash = '#/'; return; }
  setHeader('Photos', `#/p/${projectId}`);
  $view.innerHTML = `
    <div id="cam"></div>
    <div class="card controls">
      <span id="count" class="muted" style="flex:1">0 photo</span>
      <button id="shutter" class="big-shutter" aria-label="Prendre une photo"></button>
      <a class="btn" style="flex:1" href="#/p/${projectId}">Terminé</a>
    </div>
    <div id="last" class="grid"></div>`;
  const cam = mountCamera($view.querySelector('#cam'));
  let n = 0;
  $view.querySelector('#shutter').onclick = async () => {
    for (const f of await cam.take()) {
      const p = await savePhoto(f, projectId);
      n++;
      $view.querySelector('#count').textContent = `${n} photo${n > 1 ? 's' : ''}`;
      $view.querySelector('#last').insertAdjacentHTML('afterbegin', `<a href="#/photo/${p.id}"><img src="${photoUrl(p)}" alt=""></a>`);
    }
  };
  return () => cam.stop();
}

// ---------- Annotation ----------
async function viewAnnotate(id) {
  const photo = await db.get('photos', id);
  if (!photo) { history.back(); return; }
  setHeader('Annoter', `#/photo/${id}`);
  const original = photo.original || photo.blob;
  const image = new Image();
  const url = URL.createObjectURL(original);
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });

  const state = { tool: 'arrow', color: COLORS[0], shapes: structuredClone(photo.annotations || []) };
  $view.innerHTML = `
    <div class="annot-tools no-print">
      <div class="seg">${TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.title}" aria-label="${t.title}">${t.label}</button>`).join('')}</div>
      <div class="seg">${COLORS.map((c) => `<button data-color="${c}" aria-label="Couleur ${c}"><span class="swatch" style="background:${c}"></span></button>`).join('')}</div>
    </div>
    <canvas id="canvas" class="annot-canvas"></canvas>
    <div class="row" style="margin-top:10px">
      <button id="undo" class="btn">↶ Annuler</button>
      <button id="clear" class="btn">Tout effacer</button>
    </div>
    <div class="row" style="margin-top:10px">
      <a class="btn" href="#/photo/${id}">Abandonner</a>
      <button id="save" class="btn primary">Enregistrer</button>
    </div>`;

  const canvas = $view.querySelector('#canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const redraw = () => renderAnnotations(canvas, image, state.shapes);
  const syncToolbar = () => {
    $view.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
    $view.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === state.color));
    $view.querySelector('#undo').disabled = !state.shapes.length;
  };
  redraw();
  syncToolbar();
  attachEditor(canvas, image, state, syncToolbar);

  $view.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => { state.tool = b.dataset.tool; syncToolbar(); }; });
  $view.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => { state.color = b.dataset.color; syncToolbar(); }; });
  $view.querySelector('#undo').onclick = () => { state.shapes.pop(); redraw(); syncToolbar(); };
  $view.querySelector('#clear').onclick = () => {
    if (state.shapes.length && confirm('Effacer toutes les annotations ?')) { state.shapes = []; redraw(); syncToolbar(); }
  };
  $view.querySelector('#save').onclick = async () => {
    // La photo d'origine est gardée à part pour pouvoir modifier les annotations plus tard.
    photo.original = original;
    photo.annotations = state.shapes;
    photo.blob = state.shapes.length
      ? await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      : original;
    await db.put('photos', photo);
    forgetPhotoUrl(id);
    location.hash = `#/photo/${id}`;
  };
  return () => URL.revokeObjectURL(url);
}

// ---------- Visite commentée ----------
async function viewWalkthrough(id) {
  const walk = await db.get('walkthroughs', id);
  if (!walk) { location.hash = '#/'; return; }
  const project = await db.get('projects', walk.projectId);
  setHeader(walk.report?.titre || 'Visite commentée', `#/p/${walk.projectId}`);
  if (walk.status === 'recording') return viewRecording(walk);
  if (walk.report) return viewReport(walk, project);
  return viewDraft(walk, project);
}

async function photoMap(projectId) {
  const map = {};
  for (const p of await db.byProject('photos', projectId)) map[p.id] = p;
  return map;
}

function timelineHtml(walk, photos) {
  if (!walk.events.length) return '<p class="muted">Rien d\'enregistré pour l\'instant.</p>';
  return `<ul class="timeline">${walk.events.map((e) => `
    <li><span class="t">${fmtClock(e.t)}</span>
      ${e.type === 'photo'
        ? (photos[e.photoId] ? `<img src="${photoUrl(photos[e.photoId])}" alt="">` : '<span class="muted">(photo supprimée)</span>')
        : `<span>${esc(e.text)}</span>`}
    </li>`).join('')}</ul>`;
}

async function viewRecording(walk) {
  let photos = await photoMap(walk.projectId);
  let running = false;          // chrono en marche
  let startedAt = 0;            // début du segment en cours
  let interim = '';
  let tick = null;

  const now = () => walk.elapsed + (running ? Date.now() - startedAt : 0);
  const save = () => db.put('walkthroughs', walk);

  const dictation = createDictation({
    onFinal: (text) => { if (text) { walk.events.push({ type: 'speech', text, t: now() }); save(); render(); } },
    onInterim: (text) => { interim = text; renderInterim(); },
    onError: (msg) => showError(msg),
  });

  $view.innerHTML = `
    <div class="card">
      <div class="rec-bar">
        <span id="dot" class="rec-dot"></span>
        <span id="timer" class="timer">00:00</span>
        <span id="state" class="muted grow"></span>
      </div>
    </div>
    <div id="err"></div>
    ${speechSupported ? '' : `<div class="card notice">La dictée automatique n'est pas disponible dans ce navigateur.
      Tapez vos notes ci-dessous ou utilisez le <strong>micro du clavier</strong> de l'iPhone.</div>`}
    <div id="cam"></div>
    <div class="card controls no-print">
      <button id="toggle" class="btn primary">▶︎ Démarrer</button>
      <button id="shutter" class="big-shutter" aria-label="Prendre une photo"></button>
      <button id="finish" class="btn">Terminer</button>
    </div>
    <div class="card">
      <textarea id="note" placeholder="Note écrite ou dictée avec le clavier…" style="min-height:60px"></textarea>
      <button id="add-note" class="btn block" style="margin-top:8px">Ajouter la note</button>
    </div>
    <div class="card">
      <div id="timeline"></div>
      <p id="interim" class="interim"></p>
    </div>
    <p class="muted">Conseil : dites où vous êtes (« Cuisine… », « Façade nord… ») avant de décrire, et mettez en pause quand vous changez de zone ou discutez d'autre chose.</p>
  `;

  const $ = (s) => $view.querySelector(s);
  function render() {
    $('#timeline').innerHTML = timelineHtml(walk, photos);
    $('#toggle').textContent = running ? '⏸ Pause' : (walk.events.length || walk.elapsed ? '▶︎ Reprendre' : '▶︎ Démarrer');
    $('#dot').classList.toggle('on', running);
    $('#state').textContent = running ? (speechSupported ? 'J\'écoute…' : 'Enregistrement') : 'En pause';
    $('#timer').textContent = fmtClock(now());
  }
  function renderInterim() { $('#interim').textContent = interim; }
  function showError(msg) { $('#err').innerHTML = msg ? `<div class="card error">${esc(msg)}</div>` : ''; }

  function start() {
    showError('');
    running = true;
    startedAt = Date.now();
    if (speechSupported) dictation.start();
    tick = setInterval(() => { $('#timer').textContent = fmtClock(now()); }, 500);
    render();
  }
  function pause() {
    if (!running) return;
    walk.elapsed = now();
    running = false;
    dictation.stop();
    clearInterval(tick);
    save();
    render();
  }

  $('#toggle').onclick = () => (running ? pause() : start());
  const cam = mountCamera($('#cam'));
  $('#shutter').onclick = async () => {
    const t = now();
    const files = await cam.take();
    for (const f of files) {
      const p = await savePhoto(f, walk.projectId, { walkthroughId: walk.id });
      photos[p.id] = p;
      walk.events.push({ type: 'photo', photoId: p.id, t });
    }
    await save();
    render();
    // Si l'appareil photo d'iOS a été ouvert, la dictée a pu être coupée : on la relance.
    if (running && speechSupported) dictation.start();
  };
  $('#add-note').onclick = () => {
    const text = $('#note').value.trim();
    if (!text) return;
    walk.events.push({ type: 'speech', text, t: now() });
    $('#note').value = '';
    save();
    render();
  };
  $('#finish').onclick = async () => {
    pause();
    if (!walk.events.length && !confirm('La visite est vide. Terminer quand même ?')) return;
    walk.status = 'draft';
    await save();
    route();
  };

  render();
  return () => { pause(); cam.stop(); };
}

async function viewDraft(walk, project) {
  const photos = await photoMap(walk.projectId);
  const nPhotos = walk.events.filter((e) => e.type === 'photo' && photos[e.photoId]).length;
  const { MAX_PHOTOS } = await ai().catch(() => ({ MAX_PHOTOS: 40 }));
  $view.innerHTML = `
    <div class="card stack">
      <button id="gen" class="btn primary block">✨ Générer le rapport IA</button>
      <button id="resume" class="btn block">🎙️ Reprendre la visite</button>
      ${nPhotos > MAX_PHOTOS ? `<p class="muted">Seules les ${MAX_PHOTOS} premières photos seront envoyées à l'IA.</p>` : ''}
    </div>
    <div id="status"></div>
    <div class="section-title"><h2>Transcription</h2></div>
    <div class="card">
      <p class="muted" style="margin-top:0">Vous pouvez corriger les phrases avant de générer le rapport.</p>
      <ul class="timeline">${walk.events.map((e, i) => `
        <li><span class="t">${fmtClock(e.t)}</span>
          ${e.type === 'photo'
            ? (photos[e.photoId] ? `<img src="${photoUrl(photos[e.photoId])}" alt="">` : '<span class="muted">(photo supprimée)</span>')
            : `<textarea data-i="${i}" style="min-height:44px">${esc(e.text)}</textarea>`}
        </li>`).join('') || '<li class="muted">Vide.</li>'}</ul>
    </div>
    <button id="del" class="btn danger block">Supprimer la visite</button>
  `;
  $view.querySelectorAll('textarea[data-i]').forEach((ta) => {
    ta.onchange = () => { walk.events[ta.dataset.i].text = ta.value; db.put('walkthroughs', walk); };
  });
  $view.querySelector('#resume').onclick = async () => {
    walk.status = 'recording';
    await db.put('walkthroughs', walk);
    route();
  };
  $view.querySelector('#del').onclick = async () => {
    if (!confirm('Supprimer cette visite ? Les photos restent dans le chantier.')) return;
    await db.del('walkthroughs', walk.id);
    location.hash = `#/p/${walk.projectId}`;
  };
  $view.querySelector('#gen').onclick = async (e) => {
    const btn = e.currentTarget;
    const $status = $view.querySelector('#status');
    btn.disabled = true;
    $status.innerHTML = '<div class="card"><div class="spinner"></div><p class="muted" style="text-align:center">Rédaction du rapport… (cela peut prendre une ou deux minutes)</p></div>';
    try {
      const mod = await ai();
      const { report, photoIds, model } = await mod.generateReport({
        apiKey: settings.apiKey,
        model: settings.model || mod.DEFAULT_MODEL,
        walk,
        photosById: photos,
        projectName: project?.name || '',
      });
      walk.report = report;
      walk.reportPhotoIds = photoIds;
      walk.reportModel = model;
      walk.docHtml = reportToHtml(report, photoIds, project, walk);
      walk.checklist = report.actions.map((a) => ({ text: a.texte, zone: a.zone, priorite: a.priorite, done: false }));
      walk.status = 'done';
      await db.put('walkthroughs', walk);
      route();
    } catch (err) {
      btn.disabled = false;
      const msg = err.message?.includes('Failed to fetch') || err.message?.includes('dynamically imported')
        ? "Impossible de joindre le service IA. Vérifiez votre connexion internet."
        : err.message;
      $status.innerHTML = `<div class="card error">${esc(msg)}</div>`;
    }
  };
}

// ---------- Rapport ----------
const SEV_LABEL = { urgent: 'Urgent', attention: 'Attention', info: 'Info' };

function reportToHtml(r, photoIds, project, walk) {
  const imgs = (nums) => {
    const ids = (nums || []).map((n) => photoIds[n - 1]).filter(Boolean);
    return ids.length ? `<div class="photos">${ids.map((id) => `<img data-photo-id="${id}" alt="">`).join('')}</div>` : '';
  };
  return `
    <h1>${esc(r.titre)}</h1>
    <p class="muted">${esc(project?.name || '')}${project?.address ? ' – ' + esc(project.address) : ''} · ${fmtDate(walk.createdAt)}</p>
    <h2>Résumé</h2>
    <p>${esc(r.resume)}</p>
    ${r.zones.map((z) => `
      <h2>${esc(z.nom)}</h2>
      ${z.observations.map((o) => `
        <p><span class="sev sev-${o.gravite}">${SEV_LABEL[o.gravite] || ''}</span>${esc(o.texte)}</p>
        ${imgs(o.photos)}`).join('')}`).join('')}
    ${r.actions.length ? `<h2>Actions à mener</h2><ul>${r.actions.map((a) => `
      <li><strong>[${esc(a.priorite)}]</strong> ${esc(a.texte)}${a.zone ? ` <span class="muted">(${esc(a.zone)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${r.points_a_verifier.length ? `<h2>Points à vérifier</h2><ul>${r.points_a_verifier.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
  `;
}

async function viewReport(walk, project) {
  const photos = await photoMap(walk.projectId);
  const done = (walk.checklist || []).filter((c) => c.done).length;
  $view.innerHTML = `
    <div class="card stack no-print">
      <div class="row">
        <button id="edit" class="btn">✏️ Modifier</button>
        <button id="pdf" class="btn">📄 PDF</button>
        <button id="share" class="btn">📤 Partager</button>
      </div>
      <a class="btn block" href="#/w/${walk.id}/checklist">☑️ Liste de tâches (${done}/${walk.checklist?.length || 0})</a>
    </div>
    <article id="doc" class="doc">${walk.docHtml}</article>
    <div class="card stack no-print" style="margin-top:12px">
      <button id="regen" class="btn block">↻ Régénérer (remplace le rapport)</button>
      <button id="del" class="btn danger block">Supprimer la visite</button>
    </div>
  `;
  const $doc = $view.querySelector('#doc');
  const fillImages = () => $doc.querySelectorAll('img[data-photo-id]').forEach((img) => {
    const p = photos[img.dataset.photoId];
    if (p) img.src = photoUrl(p); else img.remove();
  });
  fillImages();

  let saveTimer;
  const saveDoc = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const copy = $doc.cloneNode(true);
      copy.querySelectorAll('img[data-photo-id]').forEach((img) => img.removeAttribute('src'));
      walk.docHtml = copy.innerHTML;
      await db.put('walkthroughs', walk);
    }, 400);
  };
  $doc.addEventListener('input', saveDoc);

  const $edit = $view.querySelector('#edit');
  $edit.onclick = () => {
    const on = $doc.contentEditable !== 'true';
    $doc.contentEditable = on ? 'true' : 'false';
    $edit.textContent = on ? '✓ Terminé' : '✏️ Modifier';
    if (on) $doc.focus(); else saveDoc();
  };
  $view.querySelector('#pdf').onclick = () => {
    // Sur iPhone : Imprimer > geste de zoom sur l'aperçu > Partager > Enregistrer dans Fichiers.
    window.print();
  };
  $view.querySelector('#share').onclick = async () => {
    const text = $doc.innerText;
    if (navigator.share) {
      try { await navigator.share({ title: walk.report.titre, text }); } catch { /* annulé */ }
    } else {
      await navigator.clipboard?.writeText(text);
      alert('Texte du rapport copié.');
    }
  };
  $view.querySelector('#regen').onclick = async () => {
    if (!confirm('Régénérer le rapport ? Vos modifications seront perdues.')) return;
    delete walk.report;
    walk.status = 'draft';
    await db.put('walkthroughs', walk);
    route();
  };
  $view.querySelector('#del').onclick = async () => {
    if (!confirm('Supprimer cette visite et son rapport ? Les photos restent dans le chantier.')) return;
    await db.del('walkthroughs', walk.id);
    location.hash = `#/p/${walk.projectId}`;
  };
  return () => clearTimeout(saveTimer);
}

// ---------- Liste de tâches ----------
async function viewChecklist(id) {
  const walk = await db.get('walkthroughs', id);
  if (!walk) { location.hash = '#/'; return; }
  setHeader('Liste de tâches', `#/w/${id}`);
  walk.checklist ||= [];
  const render = () => {
    $view.innerHTML = `
      <div class="card">
        ${walk.checklist.map((c, i) => `
          <label class="check ${c.done ? 'done' : ''}">
            <input type="checkbox" data-i="${i}" ${c.done ? 'checked' : ''}>
            <span>${esc(c.text)}<br><span class="muted">${esc([c.priorite, c.zone].filter(Boolean).join(' · '))}</span></span>
          </label>`).join('') || '<p class="muted">Aucune tâche.</p>'}
      </div>
      <form id="add" class="card">
        <input id="new" type="text" placeholder="Nouvelle tâche">
        <button class="btn block" style="margin-top:8px">Ajouter</button>
      </form>`;
    $view.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = async () => {
        walk.checklist[cb.dataset.i].done = cb.checked;
        await db.put('walkthroughs', walk);
        render();
      };
    });
    $view.querySelector('#add').onsubmit = async (e) => {
      e.preventDefault();
      const text = $view.querySelector('#new').value.trim();
      if (!text) return;
      walk.checklist.push({ text, done: false });
      await db.put('walkthroughs', walk);
      render();
    };
  };
  render();
}

// ---------- Réglages ----------
async function viewSettings() {
  setHeader('Réglages', '#/');
  let models = [];
  let defaultModel = '';
  try {
    const mod = await ai();
    models = mod.MODELS;
    defaultModel = mod.DEFAULT_MODEL;
  } catch { /* hors connexion : le choix du modèle sera affiché plus tard */ }
  const current = settings.model || defaultModel;
  $view.innerHTML = `
    <form id="f" class="card">
      <label for="key" style="margin-top:0">Clé API Anthropic</label>
      <input id="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}">
      <p class="muted">Créez-la sur <strong>console.anthropic.com</strong> (menu API Keys). Elle reste enregistrée uniquement sur ce téléphone et sert à appeler Claude directement. Chaque rapport est facturé sur votre compte Anthropic.</p>
      ${models.length ? `
        <label for="model">Modèle IA</label>
        <select id="model">${models.map((m) => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>` : ''}
      <button class="btn primary block" style="margin-top:14px">Enregistrer</button>
      <p id="ok" class="muted"></p>
    </form>
    <div class="card">
      <strong>Installer sur l'iPhone</strong>
      <p class="muted">Dans Safari : bouton Partager → « Sur l'écran d'accueil ».</p>
      <strong>Vos données</strong>
      <p class="muted">Chantiers, photos et rapports sont stockés sur ce téléphone uniquement. Supprimer l'app ou les données de Safari les efface.</p>
      <p class="muted">Dictée automatique : ${speechSupported ? 'disponible' : 'non disponible ici (utilisez le micro du clavier)'}.</p>
    </div>`;
  $view.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    settings.apiKey = $view.querySelector('#key').value.trim();
    const m = $view.querySelector('#model');
    if (m) settings.model = m.value;
    $view.querySelector('#ok').textContent = 'Enregistré ✓';
  };
}

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* hors HTTPS en local */ });
}
route();
