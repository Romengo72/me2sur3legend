// C:\Me\AppMoney\MeParisPortifs\templates.js
// v6.2.9 — Cache mémoire avec invalidation par mtime
const fs = require('fs');
const path = require('path');

const APP_VERSION = process.env.APP_VERSION
  || (() => { try { return require('./package.json').version; } catch { return '4.0.0'; } })();

/* Cache : { filePath: { html, mtime } } */
const cache = new Map();

function getMtime(filePath) {
  try { return fs.statSync(filePath).mtimeMs; }
  catch { return 0; }
}

function renderHtml(file) {
  const full = path.join(__dirname, file);

  if (!fs.existsSync(full)) {
    console.warn('[templates] Fichier introuvable :', file);
    return null;
  }

  const mtime = getMtime(full);
  const cached = cache.get(full);

  /* Cache valide ? */
  if (cached && cached.mtime === mtime) {
    return cached.html;
  }

  try {
    let html = fs.readFileSync(full, 'utf8');

    /* Cache busting : ?v=XXX sur les <script src> et <link href> */
    html = html.replace(
      /(<(?:script|link)[^>]+(?:src|href)=["'])(\/?(?:js|css)\/[^"'?]+)(?:\?v=[^"']*)?(["'])/g,
      (match, before, url, after) => `${before}${url}?v=${APP_VERSION}${after}`
    );

    cache.set(full, { html, mtime });
    return html;
  } catch (e) {
    console.error('[templates] Erreur lecture', file, ':', e.message);
    return null;
  }
}

function invalidateCache(file = null) {
  if (file) cache.delete(path.join(__dirname, file));
  else cache.clear();
}

module.exports = { renderHtml, invalidateCache, APP_VERSION };