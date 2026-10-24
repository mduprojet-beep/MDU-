// Génération du rapport de visite avec Claude (API Anthropic), appelée
// directement depuis le téléphone avec la clé API saisie dans les réglages.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
import { resize, toBase64 } from './images.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (meilleure qualité)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (plus rapide, moins cher)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (le moins cher)' },
];
export const DEFAULT_MODEL = MODELS[0].id;
// Le repli automatique en cas de refus n'existe pas pour Haiku.
const SUPPORTS_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

// Limite volontaire pour garder des requêtes de taille raisonnable.
export const MAX_PHOTOS = 40;

const SEVERITIES = ['info', 'attention', 'urgent'];
const PRIORITIES = ['haute', 'moyenne', 'basse'];

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titre', 'resume', 'zones', 'actions', 'points_a_verifier'],
  properties: {
    titre: { type: 'string' },
    resume: { type: 'string' },
    zones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nom', 'observations'],
        properties: {
          nom: { type: 'string' },
          observations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['texte', 'gravite', 'photos'],
              properties: {
                texte: { type: 'string' },
                gravite: { type: 'string', enum: SEVERITIES },
                photos: { type: 'array', items: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['texte', 'priorite', 'zone'],
        properties: {
          texte: { type: 'string' },
          priorite: { type: 'string', enum: PRIORITIES },
          zone: { type: 'string' },
        },
      },
    },
    points_a_verifier: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `Tu es l'assistant d'un professionnel du bâtiment. Il a fait une visite de chantier en parlant à voix haute et en prenant des photos. Tu reçois la transcription de ce qu'il a dit (issue d'une dictée automatique, donc avec des fautes possibles) et les photos, numérotées, avec leur position dans la transcription.

Rédige en français un compte rendu de visite clair et professionnel :
- titre : court, avec le type de visite si on peut le déduire (inspection, métré, avancement, réserves…).
- resume : 3 à 6 phrases sur l'essentiel.
- zones : regroupe les observations par pièce ou zone dans l'ordre de la visite. Chaque observation reprend un fait dit ou clairement visible, avec sa gravité et les numéros des photos qui l'illustrent.
- actions : les travaux ou tâches à faire, formulés comme des consignes pour l'équipe.
- points_a_verifier : ce qui est ambigu, inaudible, ou contradictoire entre la parole et les photos.

Règles : n'invente aucune mesure, quantité, marque ou constat absent de la transcription ou des photos. Corrige les erreurs évidentes de dictée sans changer le sens. Si une information manque, mets-la dans points_a_verifier plutôt que de la deviner.`;

function getClient(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Construit le message : transcription avec repères [Photo n], puis chaque photo.
async function buildContent(walk, photosById, projectName) {
  const photoEvents = walk.events.filter((e) => e.type === 'photo' && photosById[e.photoId]).slice(0, MAX_PHOTOS);
  const numberOf = new Map(photoEvents.map((e, i) => [e.photoId, i + 1]));

  const lines = [];
  for (const e of walk.events) {
    if (e.type === 'speech' && e.text.trim()) lines.push(`[${fmt(e.t)}] ${e.text.trim()}`);
    if (e.type === 'photo' && numberOf.has(e.photoId)) lines.push(`[${fmt(e.t)}] [Photo ${numberOf.get(e.photoId)}]`);
  }

  const content = [{
    type: 'text',
    text: `Projet : ${projectName}\nDate de la visite : ${new Date(walk.createdAt).toLocaleString('fr-FR')}\n\nTranscription de la visite :\n${lines.join('\n') || '(aucune parole enregistrée)'}`,
  }];

  for (const e of photoEvents) {
    const photo = photosById[e.photoId];
    const small = await resize(photo.blob, 1280, 0.8);
    content.push({ type: 'text', text: `Photo ${numberOf.get(e.photoId)} (prise à ${fmt(e.t)})${photo.caption ? ` – légende : ${photo.caption}` : ''} :` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await toBase64(small) } });
  }

  return { content, photoIds: photoEvents.map((e) => e.photoId) };
}

export async function generateReport({ apiKey, model, walk, photosById, projectName }) {
  if (!apiKey) throw new Error("Ajoutez votre clé API Anthropic dans les réglages (⚙︎) avant de générer le rapport.");
  const { content, photoIds } = await buildContent(walk, photosById, projectName);
  const client = getClient(apiKey);

  const params = {
    model,
    max_tokens: 32000,
    system: SYSTEM,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: REPORT_SCHEMA },
    },
    messages: [{ role: 'user', content }],
  };
  if (SUPPORTS_FALLBACK.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let message;
  try {
    message = await client.beta.messages.stream(params).finalMessage();
  } catch (err) {
    throw new Error(explainError(err));
  }

  if (message.stop_reason === 'refusal') {
    throw new Error("L'IA a refusé de traiter cette visite. Réessayez, éventuellement avec un autre modèle dans les réglages.");
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('Le rapport était trop long et a été coupé. Réessayez avec une visite plus courte.');
  }

  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("La réponse de l'IA n'a pas pu être lue. Réessayez.");
  }
  // Les numéros de photo du rapport (1, 2, …) renvoient à photoIds.
  return { report, photoIds, model: message.model };
}

function explainError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Clé API refusée. Vérifiez-la dans les réglages.';
  if (err instanceof Anthropic.PermissionDeniedError) return "Cette clé API n'a pas accès à ce modèle.";
  if (err instanceof Anthropic.RateLimitError) return 'Trop de demandes ou crédit épuisé sur le compte Anthropic. Réessayez dans un moment.';
  if (err instanceof Anthropic.BadRequestError) return `Requête refusée par l'API : ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Pas de connexion internet (ou connexion coupée). Le brouillon est conservé, réessayez plus tard.';
  if (err instanceof Anthropic.APIError) return `Erreur du service IA (${err.status ?? '?'}). Réessayez.`;
  return err?.message || String(err);
}
