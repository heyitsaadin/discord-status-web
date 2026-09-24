// Spotify redirects here after login with a one-time code. We exchange it for
// an access token + refresh token, then show the refresh token ONCE so it can
// be copied into a Vercel env var (SPOTIFY_REFRESH_TOKEN). Nothing is stored
// automatically -- Vercel functions can't write their own env vars, so this is
// a manual copy-paste step, done only once.
//
// After you've saved SPOTIFY_REFRESH_TOKEN in Vercel, this page is never
// needed again unless you revoke access and have to reconnect.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#0b0b0f; color:#f0f0f2; max-width:640px; margin:48px auto; padding:0 20px; line-height:1.6; }
  h1 { font-size:20px; }
  code { background:#1c1c22; padding:2px 6px; border-radius:4px; word-break:break-all; }
  .box { background:#16161c; border:1px solid #2a2a33; border-radius:12px; padding:16px 18px; margin:16px 0; }
  .err { color:#ff9698; }
</style></head><body>${bodyHtml}</body></html>`;
}

module.exports = async (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send(page('Spotify setup', '<h1>Missing setup</h1><p class="err">SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET or SPOTIFY_REDIRECT_URI is not set on Vercel yet.</p>'));
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    res.status(400).send(page('Spotify login', `<h1>Login cancelled</h1><p>Spotify returned: <code>${escapeHtml(errorParam)}</code></p>`));
    return;
  }

  const cookies = parseCookies(req);
  if (!code || !state || state !== cookies.spotify_oauth_state) {
    res.status(400).send(page('Spotify login', '<h1>Could not verify this login</h1><p class="err">Missing or mismatched state. Start over from <code>/api/auth/spotify</code>.</p>'));
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      res.status(502).send(page('Spotify login', `<h1>Spotify rejected the exchange</h1><p class="err">${escapeHtml(data.error_description || data.error || tokenRes.status)}</p>`));
      return;
    }

    res.setHeader('Set-Cookie', 'spotify_oauth_state=; Path=/; Max-Age=0');
    res.status(200).send(page('Spotify connected', `
      <h1>Connected ✅</h1>
      <p>Copy this value into a new Vercel environment variable named <code>SPOTIFY_REFRESH_TOKEN</code>, then redeploy. This is shown only once.</p>
      <div class="box"><code>${escapeHtml(data.refresh_token)}</code></div>
      <p>After that's saved, the Favs section on the site will start showing your real top tracks. You can close this tab.</p>
    `));
  } catch (e) {
    res.status(502).send(page('Spotify login', '<h1>Could not reach Spotify</h1><p class="err">Try again in a moment.</p>'));
  }
};
