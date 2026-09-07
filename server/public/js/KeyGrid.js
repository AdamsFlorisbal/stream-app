import { IconLibrary } from './IconLibrary.js';

/**
 * Grade de teclas do deck.
 *
 * Responsavel por desenhar as teclas, dar o retorno tatil/visual do toque e
 * refletir o estado real do OBS (cena ativa, live, gravando, mudo) atraves do
 * campo `stateBinding` de cada tecla.
 */
export class KeyGrid extends EventTarget {
  /** Tempo de pressao longa para abrir o editor. */
  static LONG_PRESS_MS = 520;

  /** Tolerancia de movimento antes de cancelar o toque, em pixels. */
  static MOVE_TOLERANCE = 12;

  #root;
  #page = null;
  #editing = false;
  #obsState = {};
  #cells = new Map();
  #dragFromSlot = null;

  /** @param {HTMLElement} root */
  constructor(root) {
    super();
    this.#root = root;
  }

  get editing() {
    return this.#editing;
  }

  setEditing(editing) {
    this.#editing = editing;
    this.#root.classList.toggle('is-editing', editing);
    this.render(this.#page);
  }

  /** @param {object} obsState */
  setObsState(obsState) {
    this.#obsState = obsState ?? {};
    this.#refreshStates();
  }

  /**
   * Redesenha a pagina inteira.
   * @param {object|null} page
   */
  render(page) {
    this.#page = page;
    this.#cells.clear();
    this.#root.replaceChildren();
    if (!page) return;

    this.#root.style.setProperty('--cols', String(page.columns));
    this.#root.style.setProperty('--rows', String(page.rows));

    const bySlot = new Map(page.buttons.map((button) => [button.slot, button]));
    const capacity = page.columns * page.rows;

    for (let slot = 0; slot < capacity; slot += 1) {
      const button = bySlot.get(slot) ?? null;
      const cell = button ? this.#createKey(button, slot) : this.#createEmpty(slot);
      this.#root.append(cell);
      this.#cells.set(slot, { element: cell, button });
    }

    this.#refreshStates();
  }

  #createEmpty(slot) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'key is-empty';
    cell.dataset.slot = String(slot);
    cell.append(IconLibrary.create('plus'));
    cell.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('edit', { detail: { slot, button: null } }));
    });
    this.#attachDropTarget(cell, slot);
    return cell;
  }

  #createKey(button, slot) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'key';
    cell.dataset.slot = String(slot);
    cell.dataset.buttonId = button.id;
    cell.style.setProperty('--tone', button.accent ?? '#22d3ee');
    cell.setAttribute('aria-label', button.label ?? 'tecla');

    // Midia do usuario (GIF animado, PNG, video) tem prioridade sobre o glifo.
    if (button.media) {
      cell.classList.add('has-media');
      const isVideo = /\.(mp4|webm)$/i.test(button.media);
      const media = document.createElement(isVideo ? 'video' : 'img');
      media.className = 'key__media';
      media.src = button.media;
      if (isVideo) {
        media.autoplay = true;
        media.loop = true;
        media.muted = true;
        media.playsInline = true;
      } else {
        media.alt = '';
        media.decoding = 'async';
      }
      cell.append(media);
    } else {
      const icon = document.createElement('span');
      icon.className = 'key__icon';
      icon.append(IconLibrary.create(button.glyph ?? 'deck'));
      cell.append(icon);
    }

    if (button.label) {
      const label = document.createElement('span');
      label.className = 'key__label';
      label.textContent = button.label;
      cell.append(label);
    }

    if (this.#editing) {
      const pin = document.createElement('span');
      pin.className = 'key__edit-pin';
      pin.append(IconLibrary.create('drag'));
      cell.append(pin);
      cell.draggable = true;
      this.#attachDrag(cell, slot);
    }

    this.#attachPress(cell, button, slot);
    this.#attachDropTarget(cell, slot);
    return cell;
  }

  /**
   * Toque: pressao curta executa, pressao longa abre o editor.
   * Usa Pointer Events para tratar dedo, caneta e mouse com um so' caminho.
   */
  #attachPress(cell, button, slot) {
    let timer = null;
    let longPressed = false;
    let origin = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      cell.classList.remove('is-pressed');
    };

    cell.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      longPressed = false;
      origin = { x: event.clientX, y: event.clientY };
      cell.classList.add('is-pressed');
      this.#ripple(cell, event);

      timer = setTimeout(() => {
        longPressed = true;
        clear();
        if (navigator.vibrate) navigator.vibrate(18);
        this.dispatchEvent(new CustomEvent('edit', { detail: { slot, button } }));
      }, KeyGrid.LONG_PRESS_MS);
    });

    cell.addEventListener('pointermove', (event) => {
      if (!origin || !timer) return;
      const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (moved > KeyGrid.MOVE_TOLERANCE) clear();
    });

    cell.addEventListener('pointerup', () => {
      const wasPending = Boolean(timer);
      clear();
      if (longPressed) return;
      // Sem timer ativo o toque ja tinha sido cancelado por movimento.
      if (!wasPending) return;

      if (this.#editing) {
        this.dispatchEvent(new CustomEvent('edit', { detail: { slot, button } }));
        return;
      }
      if (navigator.vibrate) navigator.vibrate(10);
      this.dispatchEvent(new CustomEvent('press', { detail: { button, slot, element: cell } }));
    });

    cell.addEventListener('pointercancel', clear);
    cell.addEventListener('pointerleave', clear);
    cell.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  #ripple(cell, event) {
    const rect = cell.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.1;
    const ripple = document.createElement('span');
    ripple.className = 'key__ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${(event.clientX ?? rect.left + rect.width / 2) - rect.left}px`;
    ripple.style.top = `${(event.clientY ?? rect.top + rect.height / 2) - rect.top}px`;
    cell.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }

  #attachDrag(cell, slot) {
    cell.addEventListener('dragstart', (event) => {
      this.#dragFromSlot = slot;
      cell.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(slot));
    });
    cell.addEventListener('dragend', () => {
      cell.classList.remove('is-dragging');
      this.#dragFromSlot = null;
      for (const [, entry] of this.#cells) entry.element.classList.remove('is-drop-target');
    });
  }

  #attachDropTarget(cell, slot) {
    cell.addEventListener('dragover', (event) => {
      if (!this.#editing || this.#dragFromSlot === null || this.#dragFromSlot === slot) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      cell.classList.add('is-drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('is-drop-target'));
    cell.addEventListener('drop', (event) => {
      event.preventDefault();
      cell.classList.remove('is-drop-target');
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (!Number.isInteger(from) || from === slot) return;
      this.dispatchEvent(new CustomEvent('reorder', { detail: { from, to: slot } }));
    });
  }

  /**
   * Marca visualmente as teclas cujo `stateBinding` esta ligado agora.
   * O binding e' uma string curta gravada no perfil, por exemplo
   * `obs.scene:Live` ou `obs.recording`.
   */
  #refreshStates() {
    for (const [, entry] of this.#cells) {
      if (!entry.button) continue;
      const active = this.#evaluateBinding(entry.button.stateBinding);
      entry.element.classList.toggle('is-active', active === true);
    }
  }

  /**
   * @param {string|undefined} binding
   * @returns {boolean|null} null quando nao ha binding ou o dado nao chegou.
   */
  #evaluateBinding(binding) {
    if (!binding) return null;
    const state = this.#obsState;
    const [key, argument] = binding.split(/:(.+)/);

    switch (key) {
      case 'obs.streaming': return Boolean(state.streaming);
      case 'obs.recording': return Boolean(state.recording);
      case 'obs.recordPaused': return Boolean(state.recordPaused);
      case 'obs.virtualcam': return Boolean(state.virtualCam);
      case 'obs.replay': return Boolean(state.replayBuffer);
      case 'obs.studio': return Boolean(state.studioMode);
      case 'obs.scene': return state.currentScene === argument;
      case 'obs.preview': return state.previewScene === argument;
      case 'obs.mute': return Boolean(state.mutes?.[argument]);
      default: return null;
    }
  }

  /** Piscada de confirmacao apos uma acao bem-sucedida. */
  flash(element, kind = 'ok') {
    if (!element) return;
    const previous = element.style.boxShadow;
    const color = kind === 'ok' ? 'rgba(52,211,153,0.85)' : 'rgba(239,68,68,0.85)';
    element.style.boxShadow = `0 0 0 2px ${color}, 0 0 30px -4px ${color}`;
    setTimeout(() => { element.style.boxShadow = previous; }, 320);
  }
}
