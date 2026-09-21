// Lists every video inside /background-videos so the page can render them
// dynamically instead of hardcoding a single file. A static page can't read a
// directory on its own, so this Vercel function scans the folder on the server
// and returns the filenames as JSON.
const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg'
};

module.exports = (req, res) => {
  try {
    // process.cwd() is the project root on Vercel; __dirname/.. is the fallback
    // for local runs. includeFiles in vercel.json makes sure the folder is bundled.
    const candidates = [
      path.join(process.cwd(), 'background-videos'),
      path.join(__dirname, '..', 'background-videos')
    ];
    const dir = candidates.find((p) => fs.existsSync(p));

    let videos = [];
    if (dir) {
      videos = fs
        .readdirSync(dir)
        .filter((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map((name) => ({
          name,
          src: '/background-videos/' + encodeURIComponent(name),
          type: MIME_TYPES[path.extname(name).toLowerCase()] || 'video/mp4'
        }));
    }

    res.setHeader('Content-Type', 'application/json');
    // Cache briefly so new uploads show up quickly but the function isn't hit on every load.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ videos });
  } catch (e) {
    res.status(500).json({ videos: [], error: 'could not read background-videos' });
  }
};
