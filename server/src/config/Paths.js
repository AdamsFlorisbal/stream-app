import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Resolve e garante a existencia de todos os diretorios usados pelo servidor.
 * Centralizar isto evita caminhos relativos espalhados pelo codigo — algo que
 * quebraria facilmente no Windows, onde o processo pode ser iniciado de qualquer pasta.
 */
export class Paths {
  #root;

  /** @param {string} [dataDir] Sobrescreve o diretorio de dados (env DECK_DATA_DIR). */
  constructor(dataDir) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    this.#root = path.resolve(here, '..', '..');
    this.dataDir = path.resolve(dataDir ?? process.env.DECK_DATA_DIR ?? path.join(this.#root, 'data'));
    this.mediaDir = path.join(this.dataDir, 'media');
    this.toolsDir = path.join(this.dataDir, 'tools');
    this.publicDir = path.join(this.#root, 'public');
    this.scriptsDir = path.join(this.#root, 'scripts');
    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.profilesFile = path.join(this.dataDir, 'profiles.json');
  }

  get root() {
    return this.#root;
  }

  /** Cria os diretorios graváveis caso ainda nao existam. @returns {this} */
  ensure() {
    for (const dir of [this.dataDir, this.mediaDir, this.toolsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return this;
  }
}
