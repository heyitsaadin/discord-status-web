// Discord slash-command endpoint for /tag.
//
// Flow: you run /tag in your personal server -> Discord POSTs the command here
// -> we verify Discord's signature -> we save the tag into your Lanyard KV store
// -> the status page (which already polls Lanyard every 10s) shows it.
//
// /tag options:
//   preset  a quick tag (Reading, Travelling, ...)
//   custom  any text you type
//   place   where you are / are going. Autocomplete: your saved places first,
//           then live search results. Any typed name is accepted too.
//
//   /tag preset: Travelling  place: Kannur   ->  "✈️ Travelling to Kannur"
//   /tag preset: Coding      place: Library  ->  "💻 Coding at Library"
//   /tag place: Library                      ->  "📍 At Library"
//
// Needs these Vercel environment variables:
//   DISCORD_PUBLIC_KEY  Discord Developer Portal -> your app -> General Information
//   LANYARD_API_KEY     DM the Lanyard bot with  .apikey
const crypto = require('crypto');

const OWNER_ID = '1382308851814240298'; // only this Discord user may change the tag
const LANYARD_KV_URL = `https://api.lanyard.rest/v1/users/${OWNER_ID}/kv/tag`;
const MAX_TAG_LENGTH = 70; // was 40; room for "Travelling to <place>"

// Places you go often. They show first in the place suggestions. Edit freely.
const FAVORITE_PLACES = ['Parassinikadavu', 'Kannur', 'Thalassery', 'Kozhikode', 'Home'];
// Search results near this point rank first (Kannur, Kerala).
const PLACE_BIAS = { lat: 11.8745, lon: 75.3704 };

// Wraps a raw 32-byte Ed25519 public key into the DER format Node's crypto expects.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifySignature(publicKeyHex, signatureHex, timestamp, rawBody) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      key,
      Buffer.from(signatureHex, 'hex')
    );
  } catch (e) {
    return false;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Ephemeral reply: only you see it, so it doesn't clutter your server.
function reply(res, content) {
  res.status(200).json({ type: 4, data: { content, flags: 64 } });
}

const cut = (s, n) => [...String(s)].slice(0, n).join('');

// Suggestions for the `place` option (Discord allows up to 25, each <= 100 chars).
// Discord gives us 3 seconds, so the live search has a short timeout and the
// saved places still work if it is slow.
async function placeChoices(query) {
  const q = String(query || '').trim();
  const choices = [];
  const seen = new Set();
  const add = (label, value) => {
    const v = cut(value, 40).trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key) || choices.length >= 25) return;
    seen.add(key);
    choices.push({ name: cut(label, 100), value: v });
  };

  // 1. exactly what was typed, so any name is accepted
  if (q) add(`Use "${q}"`, q);

  // 2. saved places
  for (const f of FAVORITE_PLACES) {
    if (!q || f.toLowerCase().includes(q.toLowerCase())) add(`⭐ ${f}`, f);
  }

  // 3. live search (OpenStreetMap data via Photon, no API key)
  if (q.length >= 2) {
    try {
      const url =
        'https://photon.komoot.io/api/?limit=8&lang=en' +
        `&lat=${PLACE_BIAS.lat}&lon=${PLACE_BIAS.lon}&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'status-tag-bot' },
        signal: AbortSignal.timeout(1800),
      });
      if (r.ok) {
        const data = await r.json();
        for (const f of data.features || []) {
          const p = f.properties || {};
          if (!p.name) continue;
          const area = [p.city || p.county, p.state].filter(Boolean).join(', ');
          add(`📍 ${p.name}${area ? ', ' + area : ''}`, p.name);
        }
      }
    } catch (e) {
      // search was slow or down: the saved places above still show
    }
  }
  return choices;
}

const handler = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    res.status(500).send('DISCORD_PUBLIC_KEY is not set');
    return;
  }

  // Discord signs the exact raw bytes, so read them before anything parses the body.
  let raw = await readRawBody(req);
  if (raw.length === 0 && req.body) {
    raw = Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  if (!signature || !timestamp || !verifySignature(publicKey, signature, timestamp, raw)) {
    res.status(401).send('invalid request signature');
    return;
  }

  const interaction = JSON.parse(raw.toString('utf8'));

  // Discord's endpoint check: it sends a PING and expects a PONG.
  if (interaction.type === 1) {
    res.status(200).json({ type: 1 });
    return;
  }

  // Autocomplete while you type in the `place` box.
  if (interaction.type === 4 && interaction.data && interaction.data.name === 'tag') {
    const focused = (interaction.data.options || []).find((o) => o.focused);
    const choices =
      focused && focused.name === 'place' ? await placeChoices(focused.value) : [];
    res.status(200).json({ type: 8, data: { choices } });
    return;
  }

  if (interaction.type === 2 && interaction.data && interaction.data.name === 'tag') {
    const invoker = (interaction.member && interaction.member.user) || interaction.user;
    if (!invoker || invoker.id !== OWNER_ID) {
      reply(res, '🔒 Only Aadin can change this tag.');
      return;
    }

    const opts = {};
    for (const o of interaction.data.options || []) opts[o.name] = o.value;

    // If both are given, the typed custom text wins over the preset.
    let text = String(opts.custom || opts.preset || '').trim();
    const place = cut(String(opts.place || '').trim(), 40);
    if (!text && !place) {
      reply(res, 'Pick a `preset`, type a `custom` tag, or give a `place`, e.g. `/tag preset: Travelling place: Kannur`.');
      return;
    }

    const apiKey = process.env.LANYARD_API_KEY;
    if (!apiKey) {
      reply(res, '⚠️ LANYARD_API_KEY is not set on Vercel yet.');
      return;
    }

    const clearing = text.toLowerCase() === 'clear';
    if (!clearing) {
      if (place) {
        // "Travelling to Kannur", "Coding at Library", or just "At Library"
        if (!text) {
          text = `📍 At ${place}`;
        } else {
          const word = /travell?ing/i.test(text) ? 'to' : 'at';
          text = `${text} ${word} ${place}`;
        }
      }
      text = cut(text, MAX_TAG_LENGTH);
    }

    try {
      const r = await fetch(LANYARD_KV_URL, {
        method: clearing ? 'DELETE' : 'PUT',
        headers: { Authorization: apiKey, 'Content-Type': 'text/plain' },
        body: clearing ? undefined : text,
        signal: AbortSignal.timeout(2500), // Discord gives us 3 seconds to answer
      });
      if (!r.ok) {
        reply(res, `⚠️ Lanyard said ${r.status}. Check that LANYARD_API_KEY is correct.`);
        return;
      }
      reply(
        res,
        clearing
          ? '🧹 Tag cleared. It will disappear from your status page within ~10 seconds.'
          : `✅ Tag set to **${text}**. It will show on your status page within ~10 seconds.`
      );
    } catch (e) {
      reply(res, '⚠️ Could not reach Lanyard in time. Try the command again.');
    }
    return;
  }

  res.status(400).send('unhandled interaction');
};

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
