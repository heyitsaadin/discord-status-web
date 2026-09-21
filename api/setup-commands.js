// One-time setup: open  /api/setup-commands  in your browser to register the /tag
// command with Discord. Safe to re-run -- it just re-sends the same definition.
// Run it again whenever you edit the preset list below. You can delete this file
// once the command shows up in Discord.
//
// Needs these Vercel environment variables:
//   DISCORD_APP_ID      Developer Portal -> your app -> General Information -> Application ID
//   DISCORD_BOT_TOKEN   Developer Portal -> your app -> Bot -> Reset Token
const PRESETS = [
  '📖 Reading',
  '📚 Studying',
  '🏫 At school',
  '✈️ Travelling',
  '💻 Coding',
  '🌱 Touching grass',
  '🎮 Gaming',
  '😴 Sleeping',
];

const COMMAND = {
  name: 'tag',
  type: 1,
  description: 'Set the tag shown on my live status page',
  options: [
    {
      type: 3,
      name: 'preset',
      description: 'Pick a quick tag',
      required: false,
      choices: [
        ...PRESETS.map((p) => ({ name: p, value: p })),
        { name: '✖ Clear tag', value: 'clear' },
      ],
    },
    {
      type: 3,
      name: 'custom',
      description: 'Or type anything you want (max 40 characters)',
      required: false,
      max_length: 40,
    },
  ],
};

module.exports = async (req, res) => {
  const appId = process.env.DISCORD_APP_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) {
    res.status(500).send('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN in Vercel first, then redeploy.');
    return;
  }

  try {
    const r = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([COMMAND]),
    });
    const body = await r.text();
    if (r.ok) {
      res.status(200).send('Registered /tag. Open your server and type /tag. You can delete api/setup-commands.js now.');
    } else {
      res.status(502).send(`Discord said ${r.status}: ${body}`);
    }
  } catch (e) {
    res.status(502).send('Could not reach Discord: ' + e.message);
  }
};
