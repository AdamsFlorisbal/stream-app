/**
 * Logger hierarquico com escopo nomeado e saida colorida.
 * Cada subsistema recebe seu proprio filho via `logger.child('Nome')`.
 */
export class Logger {
  /** @type {Record<string, number>} */
  static LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

  static #palette = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m'
  };

  #scope;
  #threshold;

  /**
   * @param {string} scope Nome exibido entre colchetes.
   * @param {keyof typeof Logger.LEVELS} [level] Nivel minimo emitido.
   */
  constructor(scope = 'app', level = process.env.LOG_LEVEL ?? 'info') {
    this.#scope = scope;
    this.#threshold = Logger.LEVELS[level] ?? Logger.LEVELS.info;
  }

  get scope() {
    return this.#scope;
  }

  /**
   * Cria um logger derivado preservando o nivel configurado.
   * @param {string} scope
   * @returns {Logger}
   */
  child(scope) {
    const next = new Logger(`${this.#scope}:${scope}`);
    next.setLevel(this.#levelName());
    return next;
  }

  /** @param {keyof typeof Logger.LEVELS} level */
  setLevel(level) {
    this.#threshold = Logger.LEVELS[level] ?? this.#threshold;
  }

  debug(...args) { this.#emit('debug', args); }
  info(...args) { this.#emit('info', args); }
  warn(...args) { this.#emit('warn', args); }
  error(...args) { this.#emit('error', args); }

  #levelName() {
    return Object.keys(Logger.LEVELS).find((k) => Logger.LEVELS[k] === this.#threshold) ?? 'info';
  }

  #emit(level, args) {
    if (Logger.LEVELS[level] < this.#threshold) return;
    const stamp = new Date().toTimeString().slice(0, 8);
    const color = Logger.#palette[level] ?? '';
    const head = `${color}${stamp} ${level.toUpperCase().padEnd(5)} [${this.#scope}]\x1b[0m`;
    const sink = level === 'error' ? console.error : console.log;
    sink(head, ...args);
  }
}

export const rootLogger = new Logger('deck');
