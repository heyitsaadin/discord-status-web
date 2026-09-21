// Serves the current Discord avatar as a PNG so link previews (WhatsApp, Discord,
// Telegram, etc.) can use it as the site logo. Link-preview crawlers don't run
// JavaScript, so the image has to come from a real URL in the HTML -- this
// endpoint looks up the latest avatar via Lanyard each time (cached for an hour),
// so it stays correct if you change your profile picture.
const DISCORD_USER_ID = '1382308851814240298';

module.exports = async (req, res) => {
  try {
    const lanyard = await fetch(`https://api.lanyard.rest/v1/users/${DISCORD_USER_ID}`);
    const json = await lanyard.json();
    const user = json && json.success && json.data && json.data.discord_user;
    if (!user) throw new Error('lanyard lookup failed');

    // Always request PNG (animated avatars return their first frame), which is
    // what preview crawlers expect.
    const url = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=512`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    const img = await fetch(url);
    if (!img.ok) throw new Error('discord cdn fetch failed');
    const buf = Buffer.from(await img.arrayBuffer());

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).send('avatar unavailable');
  }
};
