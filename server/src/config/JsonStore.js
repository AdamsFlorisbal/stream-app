import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Persistencia JSON em arquivo com escrita atomica e gravacao adiada.
 * Classe base de {@link AppConfig} e {@link ProfileStore}: ambos precisam do
 * mesmo ciclo carregar/mesclar/salvar, mudando apenas o formato padrao.
 * @template T
 */
export class JsonStore {
  #file;
  #data;
  #flushTimer = null;
  #flushDelayMs;
  #logger;

  /**
   * @param {object} options
   * @param {string} options.file Caminho absoluto do arquivo.
   * @param {T} options.defaults Estrutura usada quando o arquivo nao existe.
   * @param {import('../core/Logger.js').Logger} options.logger
   * @param {number} [options.flushDelayMs] Debounce de escrita em disco.
   */
  constructor({ file, defaults, logger, flushDelayMs = 250 }) {
    this.#file = file;
    this.#flushDelayMs = flushDelayMs;
    this.#logger = logger;
    this.#data = structuredClone(defaults);
  }

  /** @returns {T} */
  get data() {
    return this.#data;
  }

  get filePath() {
    return this.#file;
  }

  /**
   * Carrega do disco. Arquivo corrompido nao derruba o servidor: e' movido
   * para `.bak` e os padroes assumem o lugar.
   * @returns {Promise<this>}
   */
  async load() {
    try {
      const raw = await fsp.readFile(this.#file, 'utf8');
      this.#data = this.migrate(JSON.parse(raw));
      this.#logger.debug(`carregado ${path.basename(this.#file)}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.#logger.info(`${path.basename(this.#file)} inexistente, criando padrao`);
        await this.flush();
      } else {
        const backup = `${this.#file}.${Date.now()}.bak`;
        this.#logger.error(`${path.basename(this.#file)} invalido (${err.message}); backup em ${backup}`);
        await fsp.rename(this.#file, backup).catch(() => {});
        await this.flush();
      }
    }
    return this;
  }

  /**
   * Ponto de extensao para versionamento de esquema.
   * @param {any} raw
   * @returns {T}
   */
  migrate(raw) {
    return raw;
  }

  /**
   * Aplica uma mutacao e agenda a persistencia.
   * @param {(data: T) => void} mutator
   */
  update(mutator) {
    mutator(this.#data);
    this.scheduleFlush();
    return this.#data;
  }

  scheduleFlush() {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.flush().catch((err) => this.#logger.error('falha ao salvar', err));
    }, this.#flushDelayMs);
    this.#flushTimer.unref?.();
  }

  /** Escrita atomica: grava em arquivo temporario e renomeia. */
  async flush() {
    const tmp = `${this.#file}.tmp`;
    await fsp.mkdir(path.dirname(this.#file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(this.#data, null, 2), 'utf8');
    await fsp.rename(tmp, this.#file);
  }

  /** Persiste de forma sincrona — usado no desligamento do processo. */
  flushSync() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    try {
      const tmp = `${this.#file}.tmp`;
      fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.#data, null, 2), 'utf8');
      fs.renameSync(tmp, this.#file);
    } catch (err) {
      this.#logger.error('falha ao salvar na saida', err);
    }
  }
}
