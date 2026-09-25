// Vercel deployment status -> Discord.
//
// Flow: Vercel POSTs a signed event here whenever a deployment on this
// project starts, succeeds, fails, or is canceled -> this verifies the
// signature and posts a short message into a Discord channel, using the
// same bot that already handles /tag and the ping button.
//
// Setup:
//   1. Create/pick a Discord channel, copy its ID, paste it into
//      DEPLOY_CHANNEL_ID below.
//   2. Vercel Dashboard -> this project -> Settings -> Webhooks ->
//      Create Webhook. URL: https://<your-domain>/api/vercel-deploy
//      Events: Deployment Created, Deployment Succeeded, Deployment Error,
//      Deployment Canceled. Save, then copy the "Signing Secret" it shows
//      you (shown once) into the Vercel env var VERCEL_WEBHOOK_SECRET below.
//
// Needs these Vercel environment variables:
//   DISCORD_BOT_TOKEN      (already set for /api/discord and /api/ping)
//   VERCEL_WEBHOOK_SECRET   the signing secret from step 2 above

const crypto = require('crypto');

const DEPLOY_CHANNEL_ID = '1552982244862464052';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(raw, signature, secret) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha1', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (e) {
    return false; // length mismatch etc -> treat as invalid
  }
}

function formatMessage(event) {
  const type = event.type || '';
  const deployment = event.payload && event.payload.deployment ? event.payload.deployment : {};
  const project = event.payload && event.payload.project ? event.payload.project : {};
  const target = (deployment.target || event.payload?.target || 'preview');
  const url = deployment.url ? `https://${deployment.url}` : null;
  const name = project.name || 'project';

  let line;
  if (type === 'deployment.succeeded' || type === 'deployment.ready') {
    line = `✅ **${name}** deployed successfully (${target})`;
  } else if (type === 'deployment.error') {
    line = `❌ **${name}** deployment failed (${target})`;
  } else if (type === 'deployment.canceled') {
    line = `⚪ **${name}** deployment canceled (${target})`;
  } else if (type === 'deployment.created') {
    line = `🚧 **${name}** deployment started (${target})`;
  } else {
    line = `ℹ️ **${name}**: ${type}`;
  }

  return url ? `${line}\n${url}` : line;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!secret || !token) {
    res.status(500).json({ ok: false, error: 'Missing VERCEL_WEBHOOK_SECRET or DISCORD_BOT_TOKEN' });
    return;
  }

  const raw = await readRawBody(req);
  const signature = req.headers['x-vercel-signature'];
  if (!verifySignature(raw, signature, secret)) {
    res.status(401).json({ ok: false, error: 'invalid signature' });
    return;
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    res.status(400).json({ ok: false, error: 'bad json' });
    return;
  }

  // Only the terminal/creation states are worth a message -- skip anything
  // else Vercel might add later so this doesn't need constant updates.
  const relevant = ['deployment.created', 'deployment.succeeded', 'deployment.ready', 'deployment.error', 'deployment.canceled'];
  if (!relevant.includes(event.type)) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  const content = formatMessage(event);

  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${DEPLOY_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      const body = await r.text();
      res.status(502).json({ ok: false, error: `Discord said ${r.status}: ${body}` });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'Could not reach Discord in time.' });
  }
};
