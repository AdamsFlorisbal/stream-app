import { SensorProvider } from './SensorProvider.js';
import { SensorSnapshot } from './SensorSnapshot.js';

/**
 * Le sensores do servidor web embutido do LibreHardwareMonitor (`/data.json`).
 *
 * Esta e' a unica origem que entrega temperatura real de CPU e GPU no Windows
 * para qualquer fabricante (AMD, Intel e NVIDIA) — o Windows nao expoe isso por
 * API publica. O LHM carrega um driver em modo kernel para ler os sensores, por
 * isso e' um programa a parte e nao uma biblioteca npm.
 */
export class LibreHardwareMonitorProvider extends SensorProvider {
  /** Classificacao do hardware pelo nome do no; tem precedencia sobre o icone. */
  static PATTERNS = Object.freeze({
    gpu: /(geforce|radeon|\brtx\b|\bgtx\b|\barc\b|iris|(uhd|hd) graphics|vega|quadro|firepro|\bgpu\b)/i,
    cpu: /(ryzen|threadripper|athlon|\bepyc\b|core\s*(ultra\s*)?i\d|core\s*2|xeon|pentium|celeron|\bcpu\b)/i,
    memory: /(generic memory|^memory$|\bdimm\b|\bram\b)/i,
    storage: /(nvme|\bssd\b|\bhdd\b|samsung|western digital|\bwdc\b|seagate|kingston|crucial|sandisk|sabrent|\bst\d{3,})/i,
    board: /(mainboard|motherboard|\basus\b|gigabyte|msi|asrock|\bb\d{3}\b|\bx\d{3}\b|\bz\d{3}\b)/i,
    network: /(ethernet|wi-?fi|wireless|realtek.*nic|intel.*(i2\d\d|ethernet))/i
  });

  #url;
  #timeoutMs;

  /**
   * @param {object} deps
   * @param {string} deps.url
   * @param {import('../core/Logger.js').Logger} deps.logger
   * @param {number} [deps.timeoutMs]
   */
  constructor({ url, logger, timeoutMs = 2000 }) {
    super({ name: 'libre-hardware-monitor', priority: 100, logger });
    this.#url = url;
    this.#timeoutMs = timeoutMs;
  }

  get url() {
    return this.#url;
  }

  setUrl(url) {
    this.#url = url;
  }

  async probe() {
    try {
      const tree = await this.#fetchTree();
      this.available = Boolean(tree);
      return this.available;
    } catch (err) {
      this.available = false;
      this.lastError = err.message;
      return false;
    }
  }

  async read() {
    const tree = await this.#fetchTree();
    if (!tree) return null;

    const machines = tree.Children ?? [];
    /** @type {any[]} */
    const hardware = [];
    for (const machine of machines) hardware.push(...(machine.Children ?? []));
    if (hardware.length === 0) return null;

    const cpuNode = this.#classify(hardware, 'cpu');
    const gpuNode = this.#classify(hardware, 'gpu');
    const ramNode = this.#classify(hardware, 'memory');
    const diskNode = this.#classify(hardware, 'storage');
    const boardNode = this.#classify(hardware, 'board');

    const raw = {
      at: Date.now(),
      source: 'libre-hardware-monitor',
      cpu: this.#readCpu(cpuNode),
      gpu: this.#readGpu(gpuNode),
      memory: this.#readMemory(ramNode),
      disk: this.#readDisk(diskNode),
      motherboard: {
        name: boardNode?.Text ?? null,
        temperature: this.#pick(this.#flatten(boardNode), { unit: 'C' })
      },
      fans: this.#readFans(hardware)
    };

    const snapshot = new SensorSnapshot(raw);
    return snapshot.isEmpty ? null : snapshot;
  }

  async #fetchTree() {
    const response = await fetch(this.#url, {
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const tree = await response.json();
    if (!tree || typeof tree !== 'object' || !Array.isArray(tree.Children)) {
      throw new Error('formato inesperado em data.json');
    }
    return tree;
  }

  /**
   * Escolhe o no de hardware de um tipo. Nome primeiro (mais confiavel),
   * icone como desempate.
   * @param {any[]} hardware
   * @param {keyof typeof LibreHardwareMonitorProvider.PATTERNS} kind
   */
  #classify(hardware, kind) {
    const pattern = LibreHardwareMonitorProvider.PATTERNS[kind];
    const byName = hardware.find((node) => pattern.test(String(node.Text ?? '')));
    if (byName) return byName;

    const iconHints = {
      cpu: ['cpu'],
      gpu: ['nvidia', 'amd', 'gpu', 'ati'],
      memory: ['ram'],
      storage: ['hdd', 'ssd'],
      board: ['mainboard'],
      network: ['nic']
    }[kind] ?? [];

    return hardware.find((node) => {
      const icon = String(node.ImageURL ?? '').toLowerCase();
      // "cpu" nunca deve casar com GPU: a checagem por nome ja rodou acima.
      if (kind === 'gpu' && icon.includes('cpu')) return false;
      return iconHints.some((hint) => icon.includes(hint));
    }) ?? null;
  }

  /**
   * Achata a arvore de um hardware em folhas consultaveis.
   * @param {any} node
   * @returns {Array<{ name: string, group: string, value: number|null, unit: string }>}
   */
  #flatten(node) {
    if (!node) return [];
    const leaves = [];
    const walk = (current, group) => {
      for (const child of current.Children ?? []) {
        const hasChildren = Array.isArray(child.Children) && child.Children.length > 0;
        if (hasChildren) {
          walk(child, String(child.Text ?? group));
        } else if (child.Value !== undefined && child.Value !== null && child.Value !== '') {
          leaves.push({
            name: String(child.Text ?? ''),
            group,
            value: SensorProvider.parseLocalizedNumber(child.Value),
            unit: LibreHardwareMonitorProvider.#unitOf(child.Value)
          });
        }
      }
    };
    walk(node, '');
    return leaves;
  }

  /** Extrai a unidade do valor formatado ("52,4 °C" -> "C"). */
  static #unitOf(value) {
    const text = String(value);
    if (/°\s*C/.test(text)) return 'C';
    if (/%/.test(text)) return '%';
    if (/\bGHz\b/i.test(text)) return 'GHz';
    if (/\bMHz\b/i.test(text)) return 'MHz';
    if (/\bRPM\b/i.test(text)) return 'RPM';
    if (/\bGB\b/i.test(text)) return 'GB';
    if (/\bMB\b/i.test(text)) return 'MB';
    if (/\bW\b/.test(text)) return 'W';
    if (/\bV\b/.test(text)) return 'V';
    return '';
  }

  /**
   * Busca um sensor por unidade, com lista de preferencias por nome.
   * Sem correspondencia, cai no maior valor daquela unidade — util para
   * temperatura, onde o nucleo mais quente e' a leitura que interessa.
   *
   * @param {Array<{name:string,group:string,value:number|null,unit:string}>} leaves
   * @param {{ unit: string, prefer?: RegExp[], group?: RegExp, aggregate?: 'max'|'first'|'sum' }} query
   */
  #pick(leaves, { unit, prefer = [], group = null, aggregate = 'max' }) {
    let pool = leaves.filter((leaf) => leaf.unit === unit && leaf.value !== null);
    if (group) pool = pool.filter((leaf) => group.test(leaf.group));
    if (pool.length === 0) return null;

    for (const pattern of prefer) {
      const hit = pool.find((leaf) => pattern.test(leaf.name));
      if (hit) return hit.value;
    }
    if (aggregate === 'first') return pool[0].value;
    if (aggregate === 'sum') return pool.reduce((total, leaf) => total + leaf.value, 0);
    return pool.reduce((best, leaf) => (leaf.value > best ? leaf.value : best), pool[0].value);
  }

  #readCpu(node) {
    if (!node) return {};
    const leaves = this.#flatten(node);
    const clockGhz = this.#pick(leaves, { unit: 'GHz', prefer: [/^CPU Core #?1$/i, /core/i] });
    return {
      name: node.Text ?? null,
      load: this.#pick(leaves, { unit: '%', prefer: [/^CPU Total$/i, /^Total$/i], group: /load/i, aggregate: 'first' }),
      temperature: this.#pick(leaves, {
        unit: 'C',
        prefer: [/Core \(Tctl\/Tdie\)/i, /^CPU Package$/i, /Core Average/i, /Core Max/i, /^CPU$/i]
      }),
      clockMhz: this.#pick(leaves, { unit: 'MHz', prefer: [/^CPU Core #?1$/i, /core/i] })
        ?? (clockGhz !== null ? Math.round(clockGhz * 1000) : null),
      powerW: this.#pick(leaves, { unit: 'W', prefer: [/^CPU Package$/i, /^Package$/i, /^CPU$/i] })
    };
  }

  #readGpu(node) {
    if (!node) return {};
    const leaves = this.#flatten(node);
    const memoryUsedGb = this.#pick(leaves, { unit: 'GB', prefer: [/Memory Used/i, /Dedicated Memory Used/i] });
    const memoryTotalGb = this.#pick(leaves, { unit: 'GB', prefer: [/Memory Total/i] });
    return {
      name: node.Text ?? null,
      load: this.#pick(leaves, {
        unit: '%',
        prefer: [/^GPU Core$/i, /^D3D 3D$/i, /^GPU$/i],
        group: /load/i,
        aggregate: 'first'
      }),
      temperature: this.#pick(leaves, { unit: 'C', prefer: [/^GPU Core$/i, /Hot ?Spot/i, /^GPU$/i] }),
      memoryUsedMb: this.#pick(leaves, { unit: 'MB', prefer: [/Memory Used/i, /Dedicated Memory Used/i] })
        ?? (memoryUsedGb !== null ? Math.round(memoryUsedGb * 1024) : null),
      memoryTotalMb: this.#pick(leaves, { unit: 'MB', prefer: [/Memory Total/i] })
        ?? (memoryTotalGb !== null ? Math.round(memoryTotalGb * 1024) : null),
      clockMhz: this.#pick(leaves, { unit: 'MHz', prefer: [/^GPU Core$/i] }),
      fanRpm: this.#pick(leaves, { unit: 'RPM' }),
      powerW: this.#pick(leaves, { unit: 'W', prefer: [/^GPU Package$/i, /^GPU Power$/i] })
    };
  }

  #readMemory(node) {
    if (!node) return {};
    const leaves = this.#flatten(node);
    const usedGb = this.#pick(leaves, { unit: 'GB', prefer: [/^Memory Used$/i], aggregate: 'first' });
    const availableGb = this.#pick(leaves, { unit: 'GB', prefer: [/^Memory Available$/i], aggregate: 'first' });
    const percent = this.#pick(leaves, { unit: '%', prefer: [/^Memory$/i], group: /load/i, aggregate: 'first' });
    const totalGb = usedGb !== null && availableGb !== null ? usedGb + availableGb : null;
    return {
      usedMb: usedGb !== null ? Math.round(usedGb * 1024) : null,
      totalMb: totalGb !== null ? Math.round(totalGb * 1024) : null,
      percent
    };
  }

  #readDisk(node) {
    if (!node) return {};
    const leaves = this.#flatten(node);
    return {
      percent: this.#pick(leaves, { unit: '%', prefer: [/Used Space/i], aggregate: 'first' }),
      temperature: this.#pick(leaves, { unit: 'C' })
    };
  }

  #readFans(hardware) {
    const fans = [];
    for (const node of hardware) {
      for (const leaf of this.#flatten(node)) {
        if (leaf.unit === 'RPM' && leaf.value) {
          fans.push({ name: `${node.Text} · ${leaf.name}`, rpm: leaf.value });
        }
      }
    }
    return fans;
  }
}
