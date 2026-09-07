import http from 'node:http';
import path from 'node:path';

/** Erro com codigo HTTP, para os controladores sinalizarem 400/404/409. */
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Servidor HTTP: seguranca, corpo da requisicao, rotas e arquivos estaticos.
 *
 * Nota de seguranca — este servidor digita teclas e abre programas na maquina.
 * Se ele respondesse com CORS permissivo, qualquer site aberto no navegador do
 * usuario poderia disparar acoes em `http://127.0.0.1:8787`. Por isso:
 *   1. nenhum cabecalho CORS permissivo e' enviado;
 *   2. requisicoes com `Origin` de outra procedencia sao recusadas;
 *   3. rotas que alteram estado exigem `Content-Type: application/json`, que um
 *      site externo nao consegue enviar sem passar pelo preflight.
 */
export class HttpServer {
  /** 16 MB: teto para upload de GIF, com folga sobre o limite da biblioteca. */
  static MAX_BODY_BYTES = 16 * 1024 * 1024;

  #server;
  #router;
  #static;
  #logger;
  #config;
  #indexFile;

  /**
   * @param {object} deps
   * @param {import('./Router.js').Router} deps.router
   * @param {import('./StaticFileHandler.js').StaticFileHandler} deps.staticHandler
   * @param {import('../config/AppConfig.js').AppConfig} deps.config
   * @param {import('../config/Paths.js').Paths} deps.paths
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ router, staticHandler, config, paths, logger }) {
    this.#router = router;
    this.#static = staticHandler;
    this.#config = config;
    this.#logger = logger.child('http');
    this.#indexFile = path.join(paths.publicDir, 'index.html');
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
  }

  get server() {
    return this.#server;
  }

  async listen() {
    const { port, host } = this.#config.server;
    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(port, host, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
    this.#logger.info(`ouvindo em http://${host}:${port}`);
    return this;
  }

  async close() {
    await new Promise((resolve) => this.#server.close(resolve));
  }

  async #handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      this.#assertSameOrigin(req, url);
      this.#assertPin(req, url);

      const route = this.#router.match(req.method ?? 'GET', url.pathname);
      if (route) {
        if (!['GET', 'HEAD'].includes(req.method) ) this.#assertJsonIntent(req);
        const body = await this.#readBody(req);
        const result = await route.handler({ req, res, params: route.params, query: url.searchParams, body });
        if (!res.writableEnded) this.#sendJson(res, 200, result ?? { ok: true });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        const status = this.#router.hasPath(url.pathname) ? 405 : 404;
        throw new HttpError(status, status === 405 ? 'metodo nao permitido' : 'rota nao encontrada');
      }

      if (await this.#static.serve(req, res, url.pathname)) return;

      // Aplicativo de pagina unica: qualquer rota desconhecida devolve o index.
      if (req.method === 'GET' && !path.extname(url.pathname)) {
        if (await this.#static.serve(req, res, '/index.html')) return;
      }

      throw new HttpError(404, 'nao encontrado');
    } catch (err) {
      this.#sendError(res, err, url);
    }
  }

  /**
   * Recusa requisicoes cujo `Origin` nao seja este proprio servidor.
   * Requisicoes sem `Origin` (o aplicativo nativo, curl) passam.
   */
  #assertSameOrigin(req, url) {
    const origin = req.headers.origin;
    if (!origin) return;
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, 'origem invalida');
    }
    const sameHost = parsed.host === url.host;
    // O WebView do Android serve o app local com origem nula ou file://.
    const localApp = parsed.protocol === 'file:' || origin === 'null';
    if (!sameHost && !localApp) {
      this.#logger.warn(`origem recusada: ${origin}`);
      throw new HttpError(403, 'origem nao permitida');
    }
  }

  /** PIN opcional de pareamento; desativado por padrao. */
  #assertPin(req, url) {
    const pin = this.#config.data.security?.pin;
    if (!pin) return;
    if (url.pathname === '/api/health') return;
    const provided = req.headers['x-deck-pin'] ?? url.searchParams.get('pin');
    if (provided !== pin) throw new HttpError(401, 'PIN invalido ou ausente');
  }

  /**
   * Exige intencao explicita de API nas rotas que alteram estado. Um formulario
   * HTML de outro site so' consegue enviar tipos simples, e nao estes.
   */
  #assertJsonIntent(req) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const allowed = ['application/json', 'application/octet-stream', ''];
    if (!allowed.includes(type)) {
      throw new HttpError(415, `Content-Type nao suportado: ${type}`);
    }
  }

  /**
   * Le o corpo. JSON vira objeto; qualquer outro tipo fica como Buffer cru,
   * que e' o caminho do upload de midia.
   */
  async #readBody(req) {
    if (['GET', 'HEAD', 'DELETE'].includes(req.method)) return null;

    const chunks = [];
    let size = 0;

    for await (const chunk of req) {
      size += chunk.length;
      if (size > HttpServer.MAX_BODY_BYTES) {
        throw new HttpError(413, 'corpo da requisicao grande demais');
      }
      chunks.push(chunk);
    }

    if (chunks.length === 0) return null;
    const buffer = Buffer.concat(chunks);
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

    if (type === 'application/json' || (!type && buffer[0] === 0x7b)) {
      try {
        return JSON.parse(buffer.toString('utf8'));
      } catch {
        throw new HttpError(400, 'JSON invalido');
      }
    }
    return buffer;
  }

  #sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  }

  #sendError(res, err, url) {
    if (res.writableEnded) return;
    const status = err instanceof HttpError ? err.status : (err.code === 'invalid' ? 400 : 500);
    if (status >= 500) this.#logger.error(`${url.pathname}: ${err.message}`);
    else this.#logger.debug(`${url.pathname}: ${status} ${err.message}`);
    this.#sendJson(res, status, { ok: false, error: err.message, code: err.code ?? null });
  }
}
