import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Serve arquivos estaticos com ETag e range de bytes.
 *
 * O range importa aqui: o app exibe GIF/WebP/MP4 nas teclas, e o WebView do
 * Android pede intervalos parciais ao reproduzir video.
 */
export class StaticFileHandler {
  static MIME = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.apng': 'image/apng',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8'
  });

  #roots;
  #logger;

  /**
   * @param {object} deps
   * @param {Record<string, string>} deps.roots Prefixo de URL -> diretorio.
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ roots, logger }) {
    this.#roots = roots;
    this.#logger = logger.child('static');
  }

  static mimeFor(filePath) {
    return StaticFileHandler.MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  }

  /**
   * Resolve o caminho no disco, bloqueando travessia de diretorio.
   * @param {string} urlPath
   * @returns {{ file: string, root: string } | null}
   */
  resolve(urlPath) {
    const clean = decodeURIComponent(urlPath.split('?')[0]);

    for (const [prefix, root] of Object.entries(this.#roots)) {
      if (prefix !== '/' && !clean.startsWith(prefix)) continue;
      const relative = prefix === '/' ? clean : clean.slice(prefix.length);
      const target = path.resolve(root, `.${path.posix.normalize(`/${relative}`)}`);

      // Uma URL como /media/../../settings.json sai da raiz permitida: recusa.
      if (target !== root && !target.startsWith(root + path.sep)) {
        this.#logger.warn(`travessia bloqueada: ${clean}`);
        continue;
      }
      return { file: target, root };
    }
    return null;
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} urlPath
   * @returns {Promise<boolean>} false quando nao ha arquivo para servir.
   */
  async serve(req, res, urlPath) {
    const resolved = this.resolve(urlPath);
    if (!resolved) return false;

    let target = resolved.file;
    let stats;
    try {
      stats = await fsp.stat(target);
      if (stats.isDirectory()) {
        target = path.join(target, 'index.html');
        stats = await fsp.stat(target);
      }
    } catch {
      return false;
    }

    const etag = `"${createHash('sha1').update(`${target}:${stats.size}:${stats.mtimeMs}`).digest('hex').slice(0, 20)}"`;
    const mime = StaticFileHandler.mimeFor(target);
    const isHtml = mime.startsWith('text/html');

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return true;
    }

    const headers = {
      'content-type': mime,
      etag,
      // O HTML nunca e' cacheado para que uma atualizacao do app chegue na
      // hora; o restante e' revalidado pelo ETag.
      'cache-control': isHtml ? 'no-cache' : 'public, max-age=0, must-revalidate',
      'accept-ranges': 'bytes'
    };

    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [startText, endText] = range.replace('bytes=', '').split('-');
      const start = Number(startText) || 0;
      const end = endText ? Math.min(Number(endText), stats.size - 1) : stats.size - 1;
      if (start > end || start >= stats.size) {
        res.writeHead(416, { 'content-range': `bytes */${stats.size}` });
        res.end();
        return true;
      }
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${stats.size}`,
        'content-length': end - start + 1
      });
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(target, { start, end }).pipe(res);
      return true;
    }

    res.writeHead(200, { ...headers, 'content-length': stats.size });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(target).pipe(res);
    return true;
  }
}
