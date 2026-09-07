import { IconLibrary } from './IconLibrary.js';

/**
 * Faixa de status do computador: CPU, GPU, memoria, disco e rede.
 *
 * Cada cartao mantem seu proprio historico curto e desenha um sparkline em SVG.
 * Os elementos sao criados uma unica vez e so' os valores mudam a cada
 * atualizacao — recriar o DOM a 1 Hz causaria piscadas visiveis no tablet.
 */
export class TelemetryPanel {
  /** Quantos pontos o mini-grafico guarda (~1 minuto a 1 Hz). */
  static HISTORY = 60;

  /** Limiares de temperatura para colorir o numero. */
  static WARM_C = 70;
  static HOT_C = 85;

  static CARDS = [
    { id: 'cpu', label: 'CPU', icon: 'cpu', tone: '#22d3ee' },
    { id: 'gpu', label: 'GPU', icon: 'gpu', tone: '#f472b6' },
    { id: 'memory', label: 'RAM', icon: 'ram', tone: '#a78bfa' },
    { id: 'disk', label: 'Disco', icon: 'disk', tone: '#fbbf24' },
    { id: 'network', label: 'Rede', icon: 'network', tone: '#34d399' }
  ];

  #root;
  #cards = new Map();
  #series = new Map();

  /** @param {HTMLElement} root */
  constructor(root) {
    this.#root = root;
    this.#build();
  }

  #build() {
    this.#root.replaceChildren();
    for (const spec of TelemetryPanel.CARDS) {
      const card = document.createElement('article');
      card.className = 'stat stat--empty';
      card.style.setProperty('--tone', spec.tone);

      const head = document.createElement('div');
      head.className = 'stat__head';
      const sub = document.createElement('span');
      sub.className = 'stat__sub';
      head.append(IconLibrary.create(spec.icon), document.createTextNode(spec.label), sub);

      const value = document.createElement('div');
      value.className = 'stat__value';
      const number = document.createElement('span');
      number.className = 'stat__number';
      number.textContent = '—';
      const unit = document.createElement('span');
      unit.className = 'stat__unit';
      const temp = document.createElement('span');
      temp.className = 'stat__temp';
      value.append(number, unit, temp);

      const bar = document.createElement('div');
      bar.className = 'stat__bar';
      const fill = document.createElement('div');
      fill.className = 'stat__fill';
      fill.style.width = '0%';
      bar.append(fill);

      const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      spark.classList.add('stat__spark');
      spark.setAttribute('viewBox', '0 0 100 34');
      spark.setAttribute('preserveAspectRatio', 'none');
      const sparkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      sparkPath.setAttribute('fill', spec.tone);
      sparkPath.setAttribute('fill-opacity', '0.35');
      sparkPath.setAttribute('stroke', spec.tone);
      sparkPath.setAttribute('stroke-width', '1');
      spark.append(sparkPath);

      card.append(spark, head, value, bar);
      this.#root.append(card);

      this.#cards.set(spec.id, { card, sub, number, unit, temp, fill, sparkPath });
      this.#series.set(spec.id, []);
    }
  }

  /**
   * @param {object} snapshot Leitura vinda do servidor.
   */
  update(snapshot) {
    if (!snapshot) return;
    this.#renderCpu(snapshot.cpu);
    this.#renderGpu(snapshot.gpu);
    this.#renderMemory(snapshot.memory);
    this.#renderDisk(snapshot.disk);
    this.#renderNetwork(snapshot.network);
  }

  #renderCpu(cpu = {}) {
    this.#apply('cpu', {
      value: cpu.load,
      unit: '%',
      percent: cpu.load,
      temperature: cpu.temperature,
      sub: cpu.clockMhz ? `${(cpu.clockMhz / 1000).toFixed(1)} GHz` : (cpu.name ? TelemetryPanel.#shortName(cpu.name) : '')
    });
  }

  #renderGpu(gpu = {}) {
    const vram = gpu.memoryUsedMb && gpu.memoryTotalMb
      ? `${(gpu.memoryUsedMb / 1024).toFixed(1)}/${(gpu.memoryTotalMb / 1024).toFixed(0)} GB`
      : (gpu.memoryUsedMb ? `${(gpu.memoryUsedMb / 1024).toFixed(1)} GB` : (gpu.name ? TelemetryPanel.#shortName(gpu.name) : ''));
    this.#apply('gpu', {
      value: gpu.load,
      unit: '%',
      percent: gpu.load,
      temperature: gpu.temperature,
      sub: vram
    });
  }

  #renderMemory(memory = {}) {
    this.#apply('memory', {
      value: memory.percent,
      unit: '%',
      percent: memory.percent,
      sub: memory.usedMb && memory.totalMb
        ? `${(memory.usedMb / 1024).toFixed(1)}/${(memory.totalMb / 1024).toFixed(0)} GB`
        : ''
    });
  }

  #renderDisk(disk = {}) {
    this.#apply('disk', {
      value: disk.percent,
      unit: '%',
      percent: disk.percent,
      temperature: disk.temperature,
      sub: disk.usedGb && disk.totalGb ? `${disk.usedGb.toFixed(0)}/${disk.totalGb.toFixed(0)} GB` : ''
    });
  }

  #renderNetwork(network = {}) {
    const down = network.downKbps;
    const formatted = TelemetryPanel.#formatRate(down);
    this.#apply('network', {
      value: formatted.value,
      unit: formatted.unit,
      // A escala de rede e' logaritmica: 100 Mbps de pico cobre uso domestico
      // sem que trafego pequeno vire uma barra invisivel.
      percent: down === null || down === undefined ? null : Math.min(100, (Math.log10(Math.max(1, down)) / 5) * 100),
      sub: network.upKbps !== null && network.upKbps !== undefined
        ? `↑ ${TelemetryPanel.#formatRate(network.upKbps).text}`
        : ''
    });
  }

  /**
   * @param {string} id
   * @param {{ value: number|string|null, unit: string, percent: number|null, temperature?: number|null, sub?: string }} data
   */
  #apply(id, data) {
    const card = this.#cards.get(id);
    if (!card) return;

    const hasValue = data.value !== null && data.value !== undefined;
    card.card.classList.toggle('stat--empty', !hasValue);
    card.number.textContent = hasValue
      ? (typeof data.value === 'number' ? TelemetryPanel.#round(data.value) : data.value)
      : '—';
    card.unit.textContent = hasValue ? data.unit : '';
    card.sub.textContent = data.sub ?? '';

    const percent = data.percent === null || data.percent === undefined ? 0 : Math.max(0, Math.min(100, data.percent));
    card.fill.style.width = `${percent}%`;

    if (data.temperature === null || data.temperature === undefined) {
      card.temp.textContent = '';
      card.temp.className = 'stat__temp';
    } else {
      card.temp.textContent = `${Math.round(data.temperature)}°`;
      card.temp.className = 'stat__temp'
        + (data.temperature >= TelemetryPanel.HOT_C ? ' is-hot'
          : data.temperature >= TelemetryPanel.WARM_C ? ' is-warm' : '');
    }

    this.#pushSeries(id, data.percent);
  }

  #pushSeries(id, percent) {
    const series = this.#series.get(id);
    if (!series) return;
    series.push(percent === null || percent === undefined ? 0 : Math.max(0, Math.min(100, percent)));
    if (series.length > TelemetryPanel.HISTORY) series.shift();
    this.#drawSpark(id, series);
  }

  #drawSpark(id, series) {
    const card = this.#cards.get(id);
    if (!card || series.length < 2) return;

    const step = 100 / (TelemetryPanel.HISTORY - 1);
    // O grafico e' ancorado a direita: o agora fica sempre na borda.
    const offset = 100 - (series.length - 1) * step;
    const points = series.map((value, index) => {
      const x = offset + index * step;
      const y = 34 - (value / 100) * 30 - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    card.sparkPath.setAttribute('d', `M${offset.toFixed(2)},34 L${points.join(' L')} L100,34 Z`);
  }

  static #round(value) {
    if (value >= 100) return String(Math.round(value));
    if (value >= 10) return value.toFixed(0);
    return value.toFixed(1).replace(/\.0$/, '');
  }

  /** Converte kbps em uma unidade legivel. */
  static #formatRate(kbps) {
    if (kbps === null || kbps === undefined) return { value: null, unit: '', text: '—' };
    if (kbps >= 1000) {
      const mb = kbps / 1000;
      return { value: mb, unit: 'Mb/s', text: `${mb.toFixed(1)} Mb/s` };
    }
    return { value: kbps, unit: 'kb/s', text: `${Math.round(kbps)} kb/s` };
  }

  static #shortName(name) {
    return String(name)
      .replace(/\((R|TM)\)/gi, '')
      .replace(/\b(CPU|Processor|Graphics)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 22);
  }
}
