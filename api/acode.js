// Receives "I'm coding in Acode" heartbeats from the Acode plugin.
//
// Flow: the Acode plugin POSTs here every ~20s while you edit -> we check the
// secret token -> we save the session into your Lanyard KV store under the key
// "acode" -> the status page (which already polls Lanyard every 10s) shows the
// coding card while the heartbeat is fresh.
//
// Vercel functions are stateless, so nothing can be kept in memory between
// requests. Lanyard KV is the storage, the same way /tag works.
//
// Needs these Vercel environment variables:
//   LANYARD_API_KEY   already set for /tag (DM the Lanyard bot with  .apikey)
//   ACODE_TOKEN       a long random secret. Put the SAME value in the Acode plugin.
//
// Body (JSON):
//   { file, language, project, startedAt }          heartbeat: you're editing
//   { stop: true }                                  clear the card right away
const OWNER_ID = '1382308851814240298';
const LANYARD_KV_URL = `https://api.lanyard.rest/v1/users/${OWNER_ID}/kv/acode`;

const MAX_FIELD = 60;

// Keep only short plain strings, so a bad payload can't stuff junk into the page.
function clean(value) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\r\n\t]+/g, ' ').trim()].slice(0, MAX_FIELD).join('');
}

function readJson(req) {
  // Vercel parses JSON bodies for us, but fall back to a raw read just in case.
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  // The Acode plugin runs inside a WebView, so the browser sends a CORS preflight first.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  const expected = process.env.ACODE_TOKEN;
  const apiKey = process.env.LANYARD_API_KEY;
  if (!expected || !apiKey) {
    res.status(500).json({ ok: false, error: 'ACODE_TOKEN or LANYARD_API_KEY is not set on Vercel' });
    return;
  }

  // Token comes as "Authorization: Bearer <token>".
  const auth = String(req.headers.authorization || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!given || given !== expected) {
    res.status(401).json({ ok: false, error: 'bad token' });
    return;
  }

  const body = await readJson(req);

  try {
    // Stop: remove the card immediately instead of waiting for the idle timeout.
    if (body.stop === true) {
      const r = await fetch(LANYARD_KV_URL, {
        method: 'DELETE',
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(5000),
      });
      res.status(r.ok ? 200 : 502).json({ ok: r.ok, cleared: r.ok });
      return;
    }

    const file = clean(body.file);
    if (!file) {
      res.status(400).json({ ok: false, error: 'file is required' });
      return;
    }

    // startedAt is when this coding session began, so the card can show "coding for 12m".
    // The plugin sends it once and keeps sending the same value on every heartbeat.
    let startedAt = Number(body.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > Date.now() + 60000) {
      startedAt = Date.now();
    }

    const session = {
      file,
      language: clean(body.language),
      project: clean(body.project),
      startedAt,
      // Server clock, so "is this fresh?" doesn't depend on the phone's clock being right.
      updatedAt: Date.now(),
    };

    // Lanyard KV values are strings, so the session is stored as JSON text.
    const r = await fetch(LANYARD_KV_URL, {
      method: 'PUT',
      headers: { Authorization: apiKey, 'Content-Type': 'text/plain' },
      body: JSON.stringify(session),
      signal: AbortSignal.timeout(5000),
    });

    if (!r.ok) {
      res.status(502).json({ ok: false, error: `Lanyard said ${r.status}` });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'could not reach Lanyard' });
  }
};
