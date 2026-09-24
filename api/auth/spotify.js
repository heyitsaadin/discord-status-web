// Starts the one-time Spotify login. Visit /api/auth/spotify in a browser,
// log in with the account whose top tracks should show on the Favs section,
// and approve access. Spotify then redirects to the callback below.
//
// Needs these Vercel environment variables:
//   SPOTIFY_CLIENT_ID       Spotify Developer Dashboard -> your app -> Settings
//   SPOTIFY_CLIENT_SECRET   same page, "View client secret"
//   SPOTIFY_REDIRECT_URI    must exactly match a Redirect URI added in the app's
//                            settings, e.g. https://<your-domain>/api/auth/spotify/callback
//
// This route only needs to be visited once (and again later only if you ever
// revoke access). It does not touch the public status page.
const crypto = require('crypto');

const SCOPE = 'user-top-read';

module.exports = async (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send('SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI is not set on Vercel yet.');
    return;
  }

  // Basic CSRF guard for the redirect round-trip.
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `spotify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('state', state);

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
};
