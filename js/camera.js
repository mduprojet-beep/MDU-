// Appareil photo intégré : aperçu en direct et prise de vue instantanée,
// sans passer par l'écran « Utiliser la photo » d'iOS.

export const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, // le micro reste libre pour la dictée
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 4032 },
      height: { ideal: 3024 },
    },
  });
  video.setAttribute('playsinline', ''); // sinon iOS passe en plein écran
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function isLive(stream) {
  return Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live'));
}

// Capture l'image affichée à la résolution réelle du flux vidéo.
export function capture(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

export function cameraErrorMessage(err) {
  if (err?.name === 'NotAllowedError') {
    return "Accès à l'appareil photo refusé. Autorisez-le dans Réglages > Safari > Appareil photo, puis rechargez la page.";
  }
  if (err?.name === 'NotFoundError') return 'Aucun appareil photo trouvé.';
  return `Appareil photo indisponible (${err?.message || err}).`;
}
