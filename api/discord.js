// Discord slash-command endpoint for /tag.
//
// Flow: you run /tag in your personal server -> Discord POSTs the command here
// -> we verify Discord's signature -> we save the tag into your Lanyard KV store
// -> the status page (which already polls Lanyard every 10s) shows it.
//
// Needs these Vercel environment variables:
//   DISCORD_PUBLIC_KEY  Discord Developer Portal -> your app -> General Information
//   LANYARD_API_KEY     DM the Lanyard bot with  .apikey
const crypto = require('crypto');

const OWNER_ID = '1382308851814240298'; // only this Discord user may change the tag
const LANYARD_KV_URL = `https://api.lanyard.rest/v1/users/${OWNER_ID}/kv/tag`;
const MAX_TAG_LENGTH = 40;

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
    if (!text) {
      reply(res, 'Pick a `preset`, or type a `custom` tag, e.g. `/tag custom: reading a book`.');
      return;
    }

    const apiKey = process.env.LANYARD_API_KEY;
    if (!apiKey) {
      reply(res, '⚠️ LANYARD_API_KEY is not set on Vercel yet.');
      return;
    }

    const clearing = text.toLowerCase() === 'clear';
    if (!clearing) text = [...text].slice(0, MAX_TAG_LENGTH).join('');

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
