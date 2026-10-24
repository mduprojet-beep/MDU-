// Redimensionnement des photos : on stocke une version raisonnable,
// et on envoie à l'IA une version plus légère.

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

export async function resize(blob, maxSide = 1600, quality = 0.82) {
  const img = await loadImage(blob);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const urls = new Map();
// URL d'affichage mise en cache par photo, pour éviter de recréer des blobs.
export function photoUrl(photo) {
  if (!urls.has(photo.id)) urls.set(photo.id, URL.createObjectURL(photo.blob));
  return urls.get(photo.id);
}
