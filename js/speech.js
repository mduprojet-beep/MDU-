// Dictée vocale via la reconnaissance vocale du navigateur (Safari / Chrome).
// Sur iPhone, elle peut ne pas être disponible selon la version d'iOS ou
// quand l'app est lancée depuis l'écran d'accueil : on le détecte et
// l'interface propose alors la dictée du clavier en secours.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = Boolean(Recognition);

export function createDictation({ lang = 'fr-FR', onFinal, onInterim, onError }) {
  let rec = null;
  let wanted = false;

  function start() {
    if (!Recognition) return false;
    wanted = true;
    rec = new Recognition();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) onFinal?.(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      onInterim?.(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted = false;
        onError?.("Micro refusé. Autorisez le micro et la reconnaissance vocale dans Réglages > Safari, ou utilisez la dictée du clavier.");
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        onError?.(`Dictée interrompue (${e.error}).`);
      }
    };
    // La reconnaissance s'arrête d'elle-même après un silence : on relance tant que l'enregistrement est actif.
    rec.onend = () => {
      onInterim?.('');
      if (wanted) {
        try { rec.start(); } catch { /* déjà démarrée */ }
      }
    };
    try {
      rec.start();
    } catch (e) {
      onError?.(`Impossible de démarrer la dictée : ${e.message}`);
      return false;
    }
    return true;
  }

  function stop() {
    wanted = false;
    if (rec) {
      try { rec.stop(); } catch { /* déjà arrêtée */ }
    }
  }

  return { start, stop };
}
