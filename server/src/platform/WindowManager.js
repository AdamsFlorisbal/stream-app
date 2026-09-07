/**
 * Enumeracao e troca de janelas / areas de trabalho virtuais.
 *
 * Mantem um cache curto da lista de janelas: a interface pede essa lista a cada
 * abertura do editor de teclas, e enumerar todas as janelas com consulta de
 * processo custa caro o suficiente para nao valer repetir a cada segundo.
 */
export class WindowManager {
  #host;
  #cache = { at: 0, windows: [] };
  #cacheTtlMs;

  /**
   * @param {object} deps
   * @param {import('./PowerShellHost.js').PowerShellHost} deps.host
   * @param {number} [deps.cacheTtlMs]
   */
  constructor({ host, cacheTtlMs = 1500 }) {
    this.#host = host;
    this.#cacheTtlMs = cacheTtlMs;
  }

  /**
   * @param {object} [options]
   * @param {string} [options.filter] Filtra por titulo ou nome do processo.
   * @param {boolean} [options.force] Ignora o cache.
   * @returns {Promise<Array<{handle:number,title:string,process:string,pid:number,foreground:boolean,minimized:boolean}>>}
   */
  async list({ filter = null, force = false } = {}) {
    const fresh = Date.now() - this.#cache.at < this.#cacheTtlMs;
    if (!force && fresh && !filter) return this.#cache.windows;

    const result = await this.#host.invoke('windows.list', filter ? { filter } : {});
    const windows = result?.windows ?? [];
    if (!filter) this.#cache = { at: Date.now(), windows };
    return windows;
  }

  /**
   * Traz uma janela para frente por handle ou por texto de busca.
   * @param {{ handle?: number, match?: string }} target
   */
  activate(target) {
    if (target?.handle) return this.#host.invoke('windows.activate', { handle: target.handle });
    if (target?.match) return this.#host.invoke('windows.activate', { match: target.match });
    throw new Error('informe handle ou match para ativar a janela');
  }

  minimize(handle) {
    return this.#host.invoke('windows.minimize', { handle });
  }

  close(handle) {
    return this.#host.invoke('windows.close', { handle });
  }

  /** @param {'next'|'prev'} direction */
  switchDesktop(direction = 'next') {
    return this.#host.invoke('desktop.switch', { direction: direction === 'prev' ? 'prev' : 'next' });
  }

  invalidateCache() {
    this.#cache = { at: 0, windows: [] };
  }
}
