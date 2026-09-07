import { ActionError } from './ActionHandler.js';

/**
 * @typedef {object} ActionContext
 * @property {import('../platform/WindowsInput.js').WindowsInput} input
 * @property {import('../platform/WindowManager.js').WindowManager} windows
 * @property {import('../platform/AudioMixer.js').AudioMixer} audio
 * @property {import('../platform/SystemControl.js').SystemControl} system
 * @property {import('../integrations/ObsController.js').ObsController} obs
 * @property {import('../config/ProfileStore.js').ProfileStore} profiles
 * @property {import('../core/EventBus.js').EventBus} bus
 * @property {import('../core/Logger.js').Logger} logger
 * @property {ActionRegistry} registry
 */

/**
 * Despacha acoes para o handler responsavel pelo seu tipo.
 *
 * Tambem e' o unico ponto onde acoes destrutivas sao barradas: qualquer tipo
 * marcado como tal exige `confirm: true` explicito vindo do cliente, para que
 * um toque acidental no tablet nao suspenda o computador.
 */
export class ActionRegistry {
  /** Tipos que so' executam com confirmacao explicita do usuario. */
  static DESTRUCTIVE = Object.freeze(new Set(['system.sleep', 'system.monitors.off']));

  #handlers = new Map();
  #instances = [];
  #logger;
  #bus;

  /**
   * @param {object} deps
   * @param {import('../core/Logger.js').Logger} deps.logger
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ logger, bus }) {
    this.#logger = logger.child('actions');
    this.#bus = bus;
  }

  /**
   * @param {import('./ActionHandler.js').ActionHandler} handler
   */
  register(handler) {
    const types = handler.constructor.types;
    if (!types?.length) throw new Error(`${handler.constructor.name} nao declara tipos`);
    for (const type of types) {
      if (this.#handlers.has(type)) {
        throw new Error(`tipo de acao duplicado: ${type}`);
      }
      this.#handlers.set(type, handler);
    }
    this.#instances.push(handler);
    return this;
  }

  get types() {
    return [...this.#handlers.keys()];
  }

  /**
   * Executa uma acao.
   * @param {{ type: string, params?: Record<string, any> }} action
   * @param {{ source?: string, confirm?: boolean }} [meta]
   */
  async execute(action, meta = {}) {
    if (!action?.type) throw new ActionError('acao sem tipo', 'invalid');

    const handler = this.#handlers.get(action.type);
    if (!handler) throw new ActionError(`acao desconhecida: ${action.type}`, 'invalid');

    if (ActionRegistry.DESTRUCTIVE.has(action.type) && meta.confirm !== true) {
      throw new ActionError(`"${action.type}" exige confirmacao`, 'denied');
    }

    const startedAt = Date.now();
    try {
      const result = await handler.execute(action.type, action.params ?? {}, {
        source: meta.source ?? 'unknown',
        confirm: meta.confirm === true
      });
      const elapsed = Date.now() - startedAt;
      this.#logger.debug(`${action.type} ok em ${elapsed}ms`);
      this.#bus.publish('action:executed', { type: action.type, ok: true, elapsed });
      return result ?? { ok: true };
    } catch (err) {
      const code = err instanceof ActionError ? err.code : 'failed';
      this.#logger.warn(`${action.type} falhou: ${err.message}`);
      this.#bus.publish('action:executed', { type: action.type, ok: false, error: err.message, code });
      throw err instanceof ActionError ? err : new ActionError(err.message, code);
    }
  }

  /**
   * Catalogo completo para o editor de teclas do aplicativo.
   * @returns {Array<{ type: string, label: string, group: string, fields?: any[], destructive?: boolean }>}
   */
  catalog() {
    const entries = [];
    for (const handler of this.#instances) {
      for (const entry of handler.describe()) {
        entries.push({ ...entry, destructive: ActionRegistry.DESTRUCTIVE.has(entry.type) });
      }
    }
    return entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }
}
