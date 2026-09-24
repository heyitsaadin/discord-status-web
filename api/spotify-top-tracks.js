// Serves your Spotify top tracks (title, artist, album art, link) to the Favs
// section on the page. Uses the refresh token saved once via the OAuth flow
// in /api/auth/spotify to mint short-lived access tokens on demand -- nothing
// here ever exposes your Spotify credentials to the browser.
//
// Needs these Vercel environment variables:
//   SPOTIFY_CLIENT_ID       same as /api/auth/spotify
//   SPOTIFY_CLIENT_SECRET   same as /api/auth/spotify
//   SPOTIFY_REFRESH_TOKEN   printed once by /api/auth/spotify-callback after login
//
// Query params:
//   ?range=short_term|medium_term|long_term   (default medium_term, ~last 6 months)
//   ?limit=1..20                              (default 8)
//
// Vercel functions are stateless between cold starts, but a warm instance can
// reuse a module-level cache across nearby requests, so this avoids hitting
// Spotify on every 10s poll from every visitor.
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;
const trackCache = new Map(); // cacheKey -> { at, data }
const TRACK_CACHE_MS = 5 * 60 * 1000; // 5 minutes

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 30000) {
    return cachedAccessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET or SPOTIFY_REFRESH_TOKEN is not set on Vercel');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Spotify token refresh failed: ${data.error_description || data.error || res.status}`);
  }

  cachedAccessToken = data.access_token;
  accessTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function shapeTrack(t) {
  const artists = Array.isArray(t.artists) ? t.artists.map((a) => a.name).join(', ') : '';
  const image = t.album && Array.isArray(t.album.images) && t.album.images.length
    ? (t.album.images.find((i) => i.width >= 300) || t.album.images[0]).url
    : '';
  return {
    id: t.id,
    name: t.name || 'Unknown track',
    artist: artists,
    album: t.album ? t.album.name : '',
    image,
    url: t.external_urls ? t.external_urls.spotify : '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, `https://${req.headers.host}`);
  const range = url.searchParams.get('range') || 'medium_term';
  const validRanges = ['short_term', 'medium_term', 'long_term'];
  const timeRange = validRanges.includes(range) ? range : 'medium_term';
  let limit = parseInt(url.searchParams.get('limit'), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 8;
  limit = Math.min(limit, 20);

  const cacheKey = `${timeRange}:${limit}`;
  const cached = trackCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TRACK_CACHE_MS) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, tracks: cached.data, cached: true });
    return;
  }

  try {
    const token = await getAccessToken();
    const apiRes = await fetch(
      `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (apiRes.status === 401) {
      // Refresh token is stale/revoked -- force a fresh one next call.
      cachedAccessToken = null;
      res.status(502).json({ ok: false, error: 'Spotify auth expired. Reconnect via /api/auth/spotify.' });
      return;
    }
    if (!apiRes.ok) {
      res.status(502).json({ ok: false, error: `Spotify said ${apiRes.status}` });
      return;
    }

    const data = await apiRes.json();
    const tracks = Array.isArray(data.items) ? data.items.map(shapeTrack) : [];
    trackCache.set(cacheKey, { at: Date.now(), data: tracks });

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, tracks, cached: false });
  } catch (e) {
    // Serve a stale cache entry rather than nothing, if one exists.
    if (cached) {
      res.status(200).json({ ok: true, tracks: cached.data, cached: true, stale: true });
      return;
    }
    res.status(502).json({ ok: false, error: e.message || 'could not reach Spotify' });
  }
};
