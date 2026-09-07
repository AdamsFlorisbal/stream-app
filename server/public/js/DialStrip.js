import { IconLibrary } from './IconLibrary.js';

/**
 * Faixa de controles giratorios, equivalente aos knobs do aparelho fisico.
 *
 * O gesto e' arrastar na horizontal sobre a celula. O valor e' atualizado
 * localmente na hora (resposta imediata ao dedo) e enviado ao servidor com
 * limitacao de frequencia — arrastar rapido geraria dezenas de requisicoes por
 * segundo, e o volume do Windows nao precisa dessa resolucao.
 */
export class DialStrip extends EventTarget {
  /** Intervalo minimo entre envios durante o arrasto. */
  static THROTTLE_MS = 70;

  /** Percurso, em fracao da largura da celula, para varrer 0-100%. */
  static SWEEP_FACTOR = 1.15;

  #root;
  #dials = new Map();
  #page = null;

  /** @param {HTMLElement} root */
  constructor(root) {
    super();
    this.#root = root;
  }

  /** @param {object|null} page */
  render(page) {
    this.#page = page;
    this.#dials.clear();
    this.#root.replaceChildren();
    if (!page?.dials?.length) {
      this.#root.hidden = true;
      return;
    }
    this.#root.hidden = false;

    for (const dial of [...page.dials].sort((a, b) => a.slot - b.slot)) {
      this.#root.append(this.#createDial(dial));
    }
  }

  #createDial(dial) {
    const cell = document.createElement('div');
    cell.className = 'dial';
    cell.dataset.dialId = dial.id;
    cell.style.setProperty('--tone', dial.accent ?? '#22d3ee');

    const head = document.createElement('div');
    head.className = 'dial__head';
    const label = document.createElement('span');
    label.className = 'dial__label';
    label.textContent = dial.label ?? '';
    const value = document.createElement('span');
    value.className = 'dial__value';
    value.textContent = '—';
    head.append(IconLibrary.create(dial.glyph ?? 'speaker'), label, value);

    const track = document.createElement('div');
    track.className = 'dial__track';
    const fill = document.createElement('div');
    fill.className = 'dial__fill';
    fill.style.width = '0%';
    track.append(fill);

    cell.append(head, track);
    this.#dials.set(dial.id, { dial, cell, value, fill, current: null });
    this.#attachGesture(cell, dial);
    return cell;
  }

  #attachGesture(cell, dial) {
    let dragging = false;
    let startX = 0;
    let startValue = 0;
    let lastSent = 0;
    let moved = false;

    cell.addEventListener('pointerdown', (event) => {
      const entry = this.#dials.get(dial.id);
      if (!entry || entry.current === null) {
        // Sem leitura inicial ainda: um toque simples pede o valor ao servidor.
        this.dispatchEvent(new CustomEvent('refresh', { detail: { dial } }));
        return;
      }
      dragging = true;
      moved = false;
      startX = event.clientX;
      startValue = entry.current;
      cell.setPointerCapture(event.pointerId);
      cell.classList.add('is-active');
    });

    cell.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;

      const span = cell.getBoundingClientRect().width * DialStrip.SWEEP_FACTOR;
      const next = Math.max(0, Math.min(100, Math.round(startValue + (dx / span) * 100)));
      this.setValue(dial.id, next, { local: true });

      const now = performance.now();
      if (now - lastSent >= DialStrip.THROTTLE_MS) {
        lastSent = now;
        this.dispatchEvent(new CustomEvent('rotate', { detail: { dial, value: next } }));
      }
    });

    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      cell.classList.remove('is-active');
      cell.releasePointerCapture?.(event.pointerId);

      const entry = this.#dials.get(dial.id);
      if (moved) {
        // Envio final garante que o servidor fique com o valor exato onde o
        // dedo parou, mesmo que o ultimo movimento tenha caido na limitacao.
        this.dispatchEvent(new CustomEvent('rotate', { detail: { dial, value: entry.current } }));
      } else {
        this.dispatchEvent(new CustomEvent('tap', { detail: { dial } }));
      }
    };

    cell.addEventListener('pointerup', finish);
    cell.addEventListener('pointercancel', finish);
  }

  /**
   * @param {string} dialId
   * @param {number|null} value 0-100
   * @param {{ local?: boolean, muted?: boolean, unavailable?: boolean }} [options]
   */
  setValue(dialId, value, { local = false, muted = null, unavailable = false } = {}) {
    const entry = this.#dials.get(dialId);
    if (!entry) return;

    entry.cell.classList.toggle('is-unavailable', unavailable);
    if (muted !== null) entry.cell.classList.toggle('is-muted', muted);

    if (value === null || value === undefined) {
      entry.current = null;
      entry.value.textContent = unavailable ? 'n/d' : '—';
      entry.fill.style.width = '0%';
      return;
    }

    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    entry.current = clamped;
    entry.value.textContent = `${clamped}%`;
    entry.fill.style.width = `${clamped}%`;
    // Durante o arrasto a transicao e' desligada para o traco colar no dedo.
    entry.fill.style.transition = local ? 'none' : '';
  }

  /** @returns {Array<object>} os knobs da pagina atual */
  get dials() {
    return this.#page?.dials ?? [];
  }
}
