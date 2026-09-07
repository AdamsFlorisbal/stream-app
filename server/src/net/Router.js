/**
 * Roteador HTTP minimo com parametros nomeados (`/api/buttons/:id`).
 *
 * Escrito a mao em vez de usar Express para manter a arvore de dependencias
 * pequena: quanto menos pacotes, mais rapido o `npm install` do usuario final
 * e menor a chance de um pacote quebrar entre versoes do Node.
 */
export class Router {
  /** @type {Array<{ method: string, segments: string[], handler: Function }>} */
  #routes = [];

  /**
   * @param {string} method
   * @param {string} pattern Ex.: `/api/pages/:pageId/buttons`
   * @param {(ctx: { req: any, res: any, params: Record<string,string>, query: URLSearchParams, body: any }) => any} handler
   */
  add(method, pattern, handler) {
    this.#routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter(Boolean),
      handler
    });
    return this;
  }

  get(pattern, handler) { return this.add('GET', pattern, handler); }
  post(pattern, handler) { return this.add('POST', pattern, handler); }
  put(pattern, handler) { return this.add('PUT', pattern, handler); }
  patch(pattern, handler) { return this.add('PATCH', pattern, handler); }
  delete(pattern, handler) { return this.add('DELETE', pattern, handler); }

  /**
   * Encontra a rota correspondente.
   * @param {string} method
   * @param {string} pathname
   * @returns {{ handler: Function, params: Record<string,string> } | null}
   */
  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.#routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;

      const params = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i];
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(parts[i]);
        } else if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  /** True quando o caminho existe mas com outro metodo — permite responder 405. */
  hasPath(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    return this.#routes.some((route) => {
      if (route.segments.length !== parts.length) return false;
      return route.segments.every((segment, i) => segment.startsWith(':') || segment === parts[i]);
    });
  }
}
