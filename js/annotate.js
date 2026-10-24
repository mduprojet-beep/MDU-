// Éditeur d'annotations : dessin libre, flèche, rectangle, cercle, texte.
// Les annotations sont gardées sous forme de formes (modifiables plus tard)
// et dessinées par-dessus la photo d'origine, qui est conservée.

export const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000'];
export const TOOLS = [
  { id: 'arrow', label: '↗︎', title: 'Flèche' },
  { id: 'pen', label: '✎', title: 'Dessin libre' },
  { id: 'rect', label: '▭', title: 'Rectangle' },
  { id: 'ellipse', label: '◯', title: 'Cercle' },
  { id: 'text', label: 'T', title: 'Texte' },
];

function drawArrow(ctx, x1, y1, x2, y2, w) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(w * 4, 18);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

export function drawShape(ctx, s) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Liseré sombre/clair pour rester lisible sur toute photo.
  ctx.shadowColor = s.color === '#000000' ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.6)';
  ctx.shadowBlur = s.width;
  if (s.type === 'pen') {
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  } else if (s.type === 'arrow') {
    drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.width);
  } else if (s.type === 'rect') {
    ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  } else if (s.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === 'text') {
    ctx.font = `bold ${s.size}px -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 0;
    ctx.lineWidth = s.size / 6;
    ctx.strokeStyle = s.color === '#000000' ? '#ffffff' : '#000000';
    s.text.split('\n').forEach((line, i) => {
      ctx.strokeText(line, s.x, s.y + i * s.size * 1.2);
      ctx.fillText(line, s.x, s.y + i * s.size * 1.2);
    });
  }
  ctx.restore();
}

export function render(canvas, image, shapes, preview) {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const s of shapes) drawShape(ctx, s);
  if (preview) drawShape(ctx, preview);
}

// Branche les gestes tactiles sur le canvas. `state` contient l'outil,
// la couleur et la liste des formes ; onChange est appelé après chaque ajout.
export function attachEditor(canvas, image, state, onChange) {
  const base = Math.max(canvas.width, canvas.height);
  const width = () => Math.round(base / 160);
  let current = null;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const [x, y] = pos(e);
    if (state.tool === 'text') {
      const text = prompt('Texte à ajouter :');
      if (text?.trim()) {
        state.shapes.push({ type: 'text', x, y, text: text.trim(), color: state.color, size: Math.round(base / 28) });
        render(canvas, image, state.shapes);
        onChange();
      }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    current = state.tool === 'pen'
      ? { type: 'pen', points: [[x, y]], color: state.color, width: width() }
      : { type: state.tool, x1: x, y1: y, x2: x, y2: y, color: state.color, width: width() };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    e.preventDefault();
    const [x, y] = pos(e);
    if (current.type === 'pen') current.points.push([x, y]);
    else { current.x2 = x; current.y2 = y; }
    render(canvas, image, state.shapes, current);
  });

  const end = () => {
    if (!current) return;
    const tiny = current.type !== 'pen' && Math.hypot(current.x2 - current.x1, current.y2 - current.y1) < base / 100;
    if (!tiny) state.shapes.push(current);
    current = null;
    render(canvas, image, state.shapes);
    onChange();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
