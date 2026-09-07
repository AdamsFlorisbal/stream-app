import { IconLibrary } from './IconLibrary.js';

/** Avisos flutuantes, com fila curta para nao empilhar demais na tela. */
export class Toaster {
  static MAX_VISIBLE = 3;
  static DEFAULT_MS = 3200;

  #root;

  /** @param {HTMLElement} root */
  constructor(root) {
    this.#root = root;
  }

  /**
   * @param {string} message
   * @param {{ kind?: 'ok'|'error'|'info', ms?: number }} [options]
   */
  show(message, { kind = 'info', ms = Toaster.DEFAULT_MS } = {}) {
    while (this.#root.children.length >= Toaster.MAX_VISIBLE) {
      this.#root.firstElementChild?.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${kind}`;
    toast.append(
      IconLibrary.create({ ok: 'check', error: 'alert', info: 'info' }[kind]),
      Object.assign(document.createElement('span'), { textContent: message })
    );
    this.#root.append(toast);

    const dismiss = () => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };
    setTimeout(dismiss, ms);
    return toast;
  }

  ok(message, ms) { return this.show(message, { kind: 'ok', ms }); }
  error(message, ms) { return this.show(message, { kind: 'error', ms: ms ?? 4600 }); }
  info(message, ms) { return this.show(message, { kind: 'info', ms }); }
}
