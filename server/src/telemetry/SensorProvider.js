import { SensorSnapshot } from './SensorSnapshot.js';

/**
 * Contrato comum das fontes de telemetria.
 *
 * Novas origens (por exemplo um agente para AIO/placa-mae especifica) so'
 * precisam estender esta classe e ser registradas no {@link TelemetryService},
 * sem que nada mais na aplicacao mude.
 *
 * @abstract
 */
export class SensorProvider {
  #name;
  #priority;

  /**
   * @param {object} options
   * @param {string} options.name Identificador curto exibido na interface.
   * @param {number} options.priority Maior vence na mesclagem.
   * @param {import('../core/Logger.js').Logger} options.logger
   */
  constructor({ name, priority, logger }) {
    if (new.target === SensorProvider) {
      throw new TypeError('SensorProvider e abstrata; estenda-a');
    }
    this.#name = name;
    this.#priority = priority;
    this.logger = logger.child(name);
    this.available = false;
    this.lastError = null;
  }

  get name() {
    return this.#name;
  }

  get priority() {
    return this.#priority;
  }

  /**
   * Verifica se a origem esta acessivel agora. Deve ser barata e nunca lancar.
   * @returns {Promise<boolean>}
   * @abstract
   */
  async probe() {
    throw new Error(`${this.#name}.probe() nao implementado`);
  }

  /**
   * Le os sensores.
   * @returns {Promise<SensorSnapshot|null>}
   * @abstract
   */
  async read() {
    throw new Error(`${this.#name}.read() nao implementado`);
  }

  /** Envolve `read()` para que uma falha isolada nunca derrube o polling. */
  async safeRead() {
    try {
      const snapshot = await this.read();
      this.available = Boolean(snapshot);
      this.lastError = null;
      return snapshot;
    } catch (err) {
      this.available = false;
      this.lastError = err.message;
      this.logger.debug(`leitura falhou: ${err.message}`);
      return null;
    }
  }

  /** Estado exibido na tela de configuracoes. */
  toStatusJSON() {
    return { name: this.#name, priority: this.#priority, available: this.available, error: this.lastError };
  }

  /**
   * Converte um valor numerico formatado por cultura ("45,3 °C" ou "45.3 °C").
   *
   * O LibreHardwareMonitor formata com a cultura do Windows, entao em pt-BR a
   * virgula e' decimal e o ponto e' separador de milhar — o inverso do en-US.
   * A desambiguacao usa a posicao do ultimo separador e a quantidade de digitos
   * que o seguem: 3 digitos indicam milhar, 1-2 indicam decimal.
   *
   * @param {string|number|null|undefined} raw
   * @returns {number|null}
   */
  static parseLocalizedNumber(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

    const text = String(raw).trim();
    if (!text) return null;

    // Remove unidade e espacos (inclusive o espaco fino usado pelo .NET).
    const cleaned = text.replace(/[^\d.,+-]/g, '');
    if (!cleaned || !/\d/.test(cleaned)) return null;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized;

    if (lastComma >= 0 && lastDot >= 0) {
      // Ambos presentes: o que aparecer por ultimo e' o separador decimal.
      const decimalSep = lastComma > lastDot ? ',' : '.';
      const groupSep = decimalSep === ',' ? '.' : ',';
      normalized = cleaned.split(groupSep).join('').replace(decimalSep, '.');
    } else if (lastComma >= 0 || lastDot >= 0) {
      const sep = lastComma >= 0 ? ',' : '.';
      const index = lastComma >= 0 ? lastComma : lastDot;
      const digitsAfter = cleaned.length - index - 1;
      normalized = digitsAfter === 3
        ? cleaned.split(sep).join('')       // milhar: 16.384 -> 16384
        : cleaned.replace(sep, '.');        // decimal: 45,3 -> 45.3
    } else {
      normalized = cleaned;
    }

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }
}
