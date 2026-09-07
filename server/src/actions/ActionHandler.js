/**
 * Erro de acao com codigo estavel, para o cliente diferenciar "configuracao
 * errada" (o usuario precisa corrigir a tecla) de "servico indisponivel"
 * (o OBS esta fechado, por exemplo).
 */
export class ActionError extends Error {
  /**
   * @param {string} message
   * @param {'invalid'|'unavailable'|'denied'|'failed'} [code]
   */
  constructor(message, code = 'failed') {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

/**
 * Base de todos os grupos de acoes.
 *
 * Um handler declara os tipos que atende e recebe o contexto com todos os
 * servicos. `describe()` alimenta o editor de teclas da interface, de modo que
 * adicionar uma acao nova a torna automaticamente selecionavel no aplicativo —
 * sem tocar no front-end.
 *
 * @abstract
 */
export class ActionHandler {
  /**
   * @param {import('./ActionRegistry.js').ActionContext} context
   */
  constructor(context) {
    if (new.target === ActionHandler) {
      throw new TypeError('ActionHandler e abstrata; estenda-a');
    }
    this.context = context;
    this.logger = context.logger.child(this.constructor.name);
  }

  /**
   * Tipos de acao atendidos por este handler.
   * @returns {string[]}
   * @abstract
   */
  static get types() {
    return [];
  }

  /**
   * Executa uma acao.
   * @param {string} type
   * @param {Record<string, any>} params
   * @param {{ source: string, confirm?: boolean }} meta
   * @returns {Promise<any>}
   * @abstract
   */
  async execute(type, params, meta) {
    throw new ActionError(`${this.constructor.name} nao implementa execute()`);
  }

  /**
   * Metadados para o editor de teclas.
   * @returns {Array<{ type: string, label: string, group: string, fields?: any[], destructive?: boolean }>}
   */
  describe() {
    return [];
  }

  /**
   * Le um parametro obrigatorio.
   * @param {Record<string, any>} params
   * @param {string} key
   */
  require(params, key) {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') {
      throw new ActionError(`parametro obrigatorio ausente: ${key}`, 'invalid');
    }
    return value;
  }
}
