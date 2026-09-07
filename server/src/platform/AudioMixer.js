/**
 * Volume e mudo dos dispositivos de audio padrao, via CoreAudio.
 *
 * `output` = alto-falantes/fones, `input` = microfone. Trabalha sempre em
 * porcentagem 0-100 para a interface, convertendo internamente.
 */
export class AudioMixer {
  static DEVICES = Object.freeze(['output', 'input']);

  #host;

  /** @param {{ host: import('./PowerShellHost.js').PowerShellHost }} deps */
  constructor({ host }) {
    this.#host = host;
  }

  /** @param {string} device */
  static assertDevice(device) {
    if (!AudioMixer.DEVICES.includes(device)) {
      throw new Error(`dispositivo invalido: ${device} (use output ou input)`);
    }
    return device;
  }

  /**
   * @param {'output'|'input'} device
   * @returns {Promise<{ device: string, level: number, muted: boolean }>}
   */
  get(device = 'output') {
    return this.#host.invoke('volume.get', { device: AudioMixer.assertDevice(device) });
  }

  /**
   * @param {'output'|'input'} device
   * @param {number} level 0-100
   */
  set(device, level) {
    const clamped = Math.max(0, Math.min(100, Number(level)));
    if (!Number.isFinite(clamped)) throw new Error('nivel de volume invalido');
    return this.#host.invoke('volume.set', { device: AudioMixer.assertDevice(device), level: clamped });
  }

  /**
   * @param {'output'|'input'} device
   * @param {number} delta Variacao em pontos percentuais (aceita negativo).
   */
  adjust(device, delta) {
    const step = Number(delta);
    if (!Number.isFinite(step)) throw new Error('delta de volume invalido');
    return this.#host.invoke('volume.adjust', { device: AudioMixer.assertDevice(device), delta: step });
  }

  /**
   * @param {'output'|'input'} device
   * @param {boolean|null} [muted] `null` alterna o estado atual.
   */
  mute(device, muted = null) {
    return this.#host.invoke('volume.mute', {
      device: AudioMixer.assertDevice(device),
      muted: muted === null ? null : Boolean(muted)
    });
  }

  /** Leitura conjunta usada pela barra de knobs da interface. */
  async snapshot() {
    const [output, input] = await Promise.all([
      this.get('output').catch(() => null),
      this.get('input').catch(() => null)
    ]);
    return { output, input };
  }
}
