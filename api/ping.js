// "Ping me" endpoint for the status page.
//
// Flow: someone on the status page taps the ping button while a custom tag is
// set -> this posts a fixed message into the #ping-me channel on your server,
// using the same bot that already handles /tag -> you see it in Discord.
//
// Needs this Vercel environment variable (already set for /api/discord):
//   DISCORD_BOT_TOKEN   Developer Portal -> your app -> Bot -> Reset Token
const PING_CHANNEL_ID = '1552695565098287216'; // #ping-me
const COOLDOWN_MS = 5 * 60 * 1000; // one ping per 5 minutes, for everyone combined

// Lives only as long as this serverless instance stays warm. Good enough for
// a low-traffic personal status page; worst case a cold start lets one extra
// ping through, which is not worth adding a database for.
let lastPingAt = 0;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  const now = Date.now();
  const remaining = COOLDOWN_MS - (now - lastPingAt);
  if (lastPingAt && remaining > 0) {
    res.status(429).json({ ok: false, error: 'cooldown', retryAfterMs: remaining });
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    res.status(500).json({ ok: false, error: 'DISCORD_BOT_TOKEN is not set' });
    return;
  }

  // Read what the page sent. All of it is free text from an anonymous visitor,
  // so it's only ever used as plain content below -- never trusted for anything
  // else -- and each field is capped so a weird payload can't blow up the message.
  let tag = '';
  let name = '';
  let message = '';
  try {
    const raw = await readRawBody(req);
    if (raw.length > 0) {
      const body = JSON.parse(raw.toString('utf8'));
      if (body && typeof body.tag === 'string') tag = body.tag.trim().slice(0, 60);
      if (body && typeof body.name === 'string') name = body.name.trim().slice(0, 60);
      if (body && typeof body.message === 'string') message = body.message.trim().slice(0, 300);
    }
  } catch (e) {
    // Malformed body: just send the generic ping below.
  }

  const who = name ? `**${name}**` : 'Someone';
  const lines = [
    tag
      ? `🔔 ${who} just pinged you from the status page while your tag says **${tag}**.`
      : `🔔 ${who} just pinged you from the status page.`,
  ];
  if (message) lines.push(`> ${message.replace(/\n/g, '\n> ')}`);
  const content = lines.join('\n');

  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${PING_CHANNEL_ID}/messages`, {
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
    lastPingAt = now;
    res.status(200).json({ ok: true, cooldownMs: COOLDOWN_MS });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'Could not reach Discord in time.' });
  }
};
