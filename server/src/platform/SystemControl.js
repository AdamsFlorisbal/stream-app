/**
 * Acoes de sistema: abrir programas e links, brilho de tela e energia.
 *
 * As operacoes destrutivas (suspender, desligar monitores) ficam atras de
 * {@link SystemControl.DESTRUCTIVE} para que a camada de acoes exija uma
 * confirmacao explicita antes de executa-las.
 */
export class SystemControl {
  /** Acoes que exigem `confirm: true` vindo do cliente. */
  static DESTRUCTIVE = Object.freeze(new Set(['system.sleep', 'system.monitors.off']));

  /** Protocolos aceitos em `openUrl` — barra `file:` e `javascript:`. */
  static SAFE_PROTOCOLS = Object.freeze(['http:', 'https:', 'mailto:', 'ms-settings:', 'steam:', 'spotify:', 'obsidian:']);

  #host;
  #logger;

  /**
   * @param {object} deps
   * @param {import('./PowerShellHost.js').PowerShellHost} deps.host
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ host, logger }) {
    this.#host = host;
    this.#logger = logger.child('system');
  }

  /**
   * @param {string} target Executavel ou caminho.
   * @param {{ args?: string[], workingDirectory?: string }} [options]
   */
  launch(target, options = {}) {
    if (!target) throw new Error('informe o programa a abrir');
    return this.#host.invoke('launch', {
      target,
      args: options.args ?? null,
      workingDirectory: options.workingDirectory ?? null
    });
  }

  /** @param {string} value */
  openUrl(value) {
    let parsed;
    try {
      parsed = new URL(String(value));
    } catch {
      throw new Error(`URL invalida: ${value}`);
    }
    if (!SystemControl.SAFE_PROTOCOLS.includes(parsed.protocol)) {
      throw new Error(`protocolo nao permitido: ${parsed.protocol}`);
    }
    return this.#host.invoke('url', { value: parsed.href });
  }

  lockWorkstation() {
    return this.#host.invoke('system.lock', {});
  }

  sleep() {
    this.#logger.warn('suspendendo o computador');
    return this.#host.invoke('system.sleep', {});
  }

  monitorsOff() {
    return this.#host.invoke('system.monitors.off', {});
  }

  /** @returns {Promise<number|null>} Brilho 0-100, ou null se o monitor nao suportar. */
  async getBrightness() {
    const result = await this.#host.invoke('display.brightness.get', {}).catch(() => null);
    return result?.brightness ?? null;
  }

  /** @param {number} level 0-100 */
  setBrightness(level) {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(level))));
    if (!Number.isFinite(clamped)) throw new Error('nivel de brilho invalido');
    return this.#host.invoke('display.brightness.set', { level: clamped });
  }
}
