/**
 * Entrada sintetica de teclado (atalhos, texto, teclas de midia).
 *
 * E' uma fachada fina sobre {@link PowerShellHost}: o valor esta em oferecer
 * um vocabulario de dominio ao resto da aplicacao, para que nenhuma outra
 * camada precise conhecer nomes de comando do agente.
 */
export class WindowsInput {
  #host;

  /** @param {{ host: import('./PowerShellHost.js').PowerShellHost }} deps */
  constructor({ host }) {
    this.#host = host;
  }

  /**
   * Dispara uma combinacao como `ctrl+shift+f1`.
   * @param {string} keys
   */
  hotkey(keys) {
    if (typeof keys !== 'string' || !keys.trim()) throw new Error('atalho vazio');
    return this.#host.invoke('hotkey', { keys: keys.trim() });
  }

  /**
   * Dispara varias combinacoes em sequencia, com pausa opcional entre elas.
   * @param {string[]} sequence
   * @param {number} [gapMs]
   */
  async hotkeySequence(sequence, gapMs = 60) {
    const results = [];
    for (const keys of sequence) {
      results.push(await this.hotkey(keys));
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    }
    return results;
  }

  /**
   * Digita texto literal por codepoint — independe do layout do teclado.
   * @param {string} value
   */
  type(value) {
    return this.#host.invoke('text', { value: String(value ?? '') });
  }

  /** @param {'playpause'|'next'|'prev'|'stop'} key */
  media(key) {
    const allowed = new Set(['playpause', 'next', 'prev', 'stop']);
    if (!allowed.has(key)) throw new Error(`tecla de midia invalida: ${key}`);
    return this.#host.invoke('media', { key });
  }
}
