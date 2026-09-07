import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Biblioteca de icones das teclas: GIF animado, PNG, WebP, AVIF, SVG e MP4.
 *
 * Os arquivos ficam em `data/media` e sao servidos em `/media/<arquivo>`.
 * O nome enviado pelo cliente nunca vira nome de arquivo diretamente — ele e'
 * saneado e prefixado com um id, porque um nome vindo do tablet e' entrada
 * nao confiavel.
 */
export class MediaLibrary {
  /** Extensoes aceitas — as animadas sao o ponto do recurso. */
  static ALLOWED = Object.freeze({
    'image/gif': '.gif',
    'image/png': '.png',
    'image/apng': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm'
  });

  /** 12 MB: mais que suficiente para um GIF de tecla, e evita encher o disco. */
  static MAX_BYTES = 12 * 1024 * 1024;

  /**
   * Assinaturas ("magic numbers") dos formatos aceitos.
   *
   * O tipo declarado pelo cliente e' apenas uma dica: quem envia e' o tablet, e
   * um cabecalho pode mentir. A extensao gravada em disco vem SEMPRE do
   * conteudo real do arquivo, e um arquivo que nao casa com nenhuma assinatura
   * conhecida e' recusado — mesmo que se apresente como imagem.
   */
  static SIGNATURES = [
    { ext: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },                        // GIF8
    { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },                        // \x89PNG
    { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },                              // JPEG SOI
    { ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46], also: { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
    { ext: '.avif', bytes: [0x66, 0x74, 0x79, 0x70], at: 4, also: { at: 8, bytes: [0x61, 0x76, 0x69, 0x66] } },
    { ext: '.mp4', bytes: [0x66, 0x74, 0x79, 0x70], at: 4 },                 // ISO-BMFF: 'ftyp' no offset 4
    { ext: '.webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] }                        // EBML (Matroska/WebM)
  ];

  /** Quanto do inicio do arquivo e' inspecionado ao procurar um SVG. */
  static SVG_SNIFF_BYTES = 1024;

  #dir;
  #logger;

  /**
   * @param {object} deps
   * @param {import('../config/Paths.js').Paths} deps.paths
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ paths, logger }) {
    this.#dir = paths.mediaDir;
    this.#logger = logger.child('media');
  }

  get directory() {
    return this.#dir;
  }

  /** @returns {Promise<Array<{ name: string, url: string, size: number, modifiedAt: number }>>} */
  async list() {
    const entries = await fsp.readdir(this.#dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!Object.values(MediaLibrary.ALLOWED).includes(extension)) continue;
      const stats = await fsp.stat(path.join(this.#dir, entry.name)).catch(() => null);
      if (!stats) continue;
      files.push({
        name: entry.name,
        url: `/media/${encodeURIComponent(entry.name)}`,
        size: stats.size,
        modifiedAt: Math.round(stats.mtimeMs)
      });
    }
    return files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  /**
   * Grava um arquivo enviado pelo aplicativo.
   * @param {object} upload
   * @param {string} upload.originalName
   * @param {string} upload.contentType
   * @param {Buffer} upload.buffer
   */
  async save({ originalName, contentType, buffer }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('arquivo vazio');
    }
    if (buffer.length > MediaLibrary.MAX_BYTES) {
      throw new Error(`arquivo maior que ${Math.round(MediaLibrary.MAX_BYTES / 1024 / 1024)} MB`);
    }

    const mime = String(contentType ?? '').split(';')[0].trim().toLowerCase();

    // A extensao vem do conteudo, nunca do cabecalho. Sem assinatura valida o
    // arquivo e' recusado: e' o que impede que um executavel renomeado para
    // .gif entre na biblioteca so' porque o cliente disse que era imagem.
    const extension = MediaLibrary.#detectExtension(buffer);
    if (!extension) {
      throw new Error(
        `o conteudo do arquivo nao corresponde a um formato aceito${mime ? ` (enviado como ${mime})` : ''}. ` +
        'Aceitos: GIF, PNG, JPEG, WebP, AVIF, SVG, MP4 e WebM.'
      );
    }

    const base = MediaLibrary.#sanitize(path.basename(String(originalName ?? 'icone'), path.extname(String(originalName ?? ''))));
    const name = `${base}-${randomUUID().slice(0, 8)}${extension}`;
    const target = path.join(this.#dir, name);

    await fsp.mkdir(this.#dir, { recursive: true });
    await fsp.writeFile(target, buffer);
    this.#logger.info(`salvo ${name} (${Math.round(buffer.length / 1024)} KB)`);

    const stats = await fsp.stat(target);
    return { name, url: `/media/${encodeURIComponent(name)}`, size: stats.size, modifiedAt: Math.round(stats.mtimeMs) };
  }

  /** @param {string} name */
  async remove(name) {
    const safe = path.basename(String(name));
    const target = path.join(this.#dir, safe);
    // basename ja impede travessia, mas a checagem torna a garantia explicita.
    if (path.dirname(target) !== this.#dir) throw new Error('nome de arquivo invalido');
    await fsp.unlink(target);
    this.#logger.info(`removido ${safe}`);
    return { removed: safe };
  }

  /**
   * Identifica o formato pelo conteudo.
   * @param {Buffer} buffer
   * @returns {string|null} extensao com ponto, ou null se nada casar.
   */
  static #detectExtension(buffer) {
    for (const signature of MediaLibrary.SIGNATURES) {
      const at = signature.at ?? 0;
      if (buffer.length < at + signature.bytes.length) continue;
      if (!signature.bytes.every((byte, i) => buffer[at + i] === byte)) continue;

      if (signature.also) {
        const { at: alsoAt, bytes } = signature.also;
        if (buffer.length < alsoAt + bytes.length) continue;
        if (!bytes.every((byte, i) => buffer[alsoAt + i] === byte)) continue;
      }
      return signature.ext;
    }

    // SVG e' texto e nao tem numero magico; identifica-se pela raiz do XML.
    if (MediaLibrary.#looksLikeSvg(buffer)) return '.svg';
    return null;
  }

  static #looksLikeSvg(buffer) {
    const head = buffer.subarray(0, MediaLibrary.SVG_SNIFF_BYTES).toString('utf8').trimStart();
    if (!head.startsWith('<?xml') && !head.startsWith('<!--') && !head.startsWith('<svg')) return false;
    return /<svg[\s>]/i.test(head);
  }

  static #sanitize(name) {
    const cleaned = String(name)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase();
    return cleaned || 'icone';
  }
}
