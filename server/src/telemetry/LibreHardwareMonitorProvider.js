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
  /**
   * Classificacao do hardware pelo nome do no. O icone entra como desempate.
   *
   * Cuidado com padroes de chipset soltos (B550, X670, Z790): eles colidem com
   * nomes de GPU como "Intel Arc B580". A colisao e' evitada de duas formas —
   * os padroes exigem contexto, e cada no e' removido do conjunto assim que
   * alguma categoria o reivindica.
   */
  static PATTERNS = Object.freeze({
    cpu: /(ryzen|threadripper|athlon|\bepyc\b|core\s*(ultra\s*)?i\d|core\s*2|xeon|pentium|celeron|genuine intel|\bcpu\b)/i,
    gpu: /(geforce|radeon|\brtx\b|\bgtx\b|\barc\b|iris|(uhd|hd) graphics|vega|quadro|firepro|\bgpu\b)/i,
    memory: /(total memory|generic memory|^memory$|\bram\b)/i,
    storage: /(nvme|\bssd\b|\bhdd\b|\bm\.2\b|samsung|western digital|\bwdc\b|seagate|kingston|crucial|sandisk|sabrent|patriot|adata|corsair|\bst\d{3,})/i,
    board: /(mainboard|motherboard|\basus\b|gigabyte|\bmsi\b|asrock|\bbiostar\b|\b[bxzhq]\d{3}[a-z]?\b)/i
  });

  /** Ordem de reivindicacao. Um no so' pertence a uma categoria. */
  static PRECEDENCE = Object.freeze(['cpu', 'gpu', 'memory', 'storage', 'board']);

  static ICON_HINTS = Object.freeze({
    cpu: ['cpu'],
    gpu: ['nvidia', 'amd', 'gpu', 'ati', 'intel'],
    memory: ['ram'],
    storage: ['hdd', 'ssd'],
    board: ['mainboard']
  });

  /**
   * Sensores em graus Celsius que NAO sao leituras de temperatura atual.
   *
   * "Warning/Critical Temperature" sao limites do fabricante (89 °C e 94 °C num
   * SSD comum) e "Distance to TjMax" e' a folga termica da CPU, nao a
   * temperatura dela. Incluir qualquer um deles na agregacao por maximo faria a
   * interface anunciar o disco a 94 °C com a maquina parada.
   */
  static NOT_A_READING = /(warning|critical|threshold|limit|distance to tjmax|tjmax)/i;

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

    /** @type {any[]} */
    const hardware = [];
    for (const machine of tree.Children ?? []) hardware.push(...(machine.Children ?? []));
    if (hardware.length === 0) return null;

    const nodes = this.#classifyAll(hardware);

    const raw = {
      at: Date.now(),
      source: 'libre-hardware-monitor',
      cpu: this.#readCpu(nodes.cpu),
      gpu: this.#readGpu(nodes.gpu),
      memory: this.#readMemory(nodes.memory),
      disk: this.#readDisk(nodes.storage),
      motherboard: {
        name: nodes.board?.Text?.trim() ?? null,
        temperature: this.#pick(this.#flatten(nodes.board), {
          unit: 'C',
          exclude: LibreHardwareMonitorProvider.NOT_A_READING
        })
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
   * Atribui um no de hardware a cada categoria, em ordem de precedencia,
   * retirando do conjunto o que ja foi reivindicado.
   *
   * @param {any[]} hardware
   * @returns {Record<string, any|null>}
   */
  #classifyAll(hardware) {
    const pool = [...hardware];
    const result = {};

    for (const kind of LibreHardwareMonitorProvider.PRECEDENCE) {
      const node = this.#classify(pool, kind);
      result[kind] = node;
      if (node) {
        const index = pool.indexOf(node);
        if (index >= 0) pool.splice(index, 1);
      }
    }
    return result;
  }

  /**
   * Escolhe o melhor no para uma categoria.
   *
   * Alem de nome e icone, ha uma validacao por capacidade: entre varios nos com
   * icone de memoria, so' serve o que realmente informa uso ("Total Memory"), e
   * nao os pentes individuais ("DIMM #0"), que so' expoem capacidade e timings.
   *
   * @param {any[]} pool
   * @param {keyof typeof LibreHardwareMonitorProvider.PATTERNS} kind
   */
  #classify(pool, kind) {
    const pattern = LibreHardwareMonitorProvider.PATTERNS[kind];
    const hints = LibreHardwareMonitorProvider.ICON_HINTS[kind] ?? [];

    const matchesIcon = (node) => {
      const icon = String(node.ImageURL ?? '').toLowerCase();
      if (kind !== 'cpu' && icon.includes('cpu')) return false;
      return hints.some((hint) => icon.includes(hint));
    };

    const byName = pool.filter((node) => pattern.test(String(node.Text ?? '')));
    const byIcon = pool.filter((node) => !byName.includes(node) && matchesIcon(node));
    const candidates = [...byName, ...byIcon];
    if (candidates.length === 0) return null;

    const usable = candidates.filter((node) => this.#isUsableFor(node, kind));
    return usable[0] ?? candidates[0];
  }

  /** Verifica se o no traz de fato os sensores que a categoria precisa. */
  #isUsableFor(node, kind) {
    const leaves = this.#flatten(node);
    switch (kind) {
      case 'memory':
        // "DIMM #0" tem apenas capacidade e timings: nao serve para uso de RAM.
        return leaves.some((leaf) => /^memory( used)?$/i.test(leaf.name));
      case 'storage':
        return leaves.some((leaf) => /^used space$/i.test(leaf.name));
      case 'cpu':
      case 'gpu':
        return leaves.some((leaf) => leaf.unit === '%' || leaf.unit === 'C');
      default:
        return true;
    }
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
            name: String(child.Text ?? '').trim(),
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
   * @param {{ unit: string, prefer?: RegExp[], group?: RegExp, exclude?: RegExp, aggregate?: 'max'|'first'|'sum' }} query
   */
  #pick(leaves, { unit, prefer = [], group = null, exclude = null, aggregate = 'max' }) {
    let pool = leaves.filter((leaf) => leaf.unit === unit && leaf.value !== null);
    if (exclude) pool = pool.filter((leaf) => !exclude.test(leaf.name));
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
      name: node.Text?.trim() ?? null,
      load: this.#pick(leaves, { unit: '%', prefer: [/^CPU Total$/i, /^Total$/i], group: /load/i, aggregate: 'first' }),
      temperature: this.#pick(leaves, {
        unit: 'C',
        prefer: [/Core \(Tctl\/Tdie\)/i, /^CPU Package$/i, /^Core Average$/i, /^Core Max$/i, /^CPU$/i],
        exclude: LibreHardwareMonitorProvider.NOT_A_READING
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
      name: node.Text?.trim() ?? null,
      load: this.#pick(leaves, {
        unit: '%',
        prefer: [/^GPU Core$/i, /^D3D 3D$/i, /^GPU$/i],
        group: /load/i,
        aggregate: 'first'
      }),
      temperature: this.#pick(leaves, {
        unit: 'C',
        prefer: [/^GPU Core$/i, /Hot ?Spot/i, /^GPU$/i],
        exclude: LibreHardwareMonitorProvider.NOT_A_READING
      }),
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
    const totalGb = this.#pick(leaves, { unit: 'GB', prefer: [/^Total Space$/i], aggregate: 'first' });
    const freeGb = this.#pick(leaves, { unit: 'GB', prefer: [/^Free Space$/i], aggregate: 'first' });
    return {
      percent: this.#pick(leaves, { unit: '%', prefer: [/^Used Space$/i], group: /load/i, aggregate: 'first' }),
      totalGb,
      usedGb: totalGb !== null && freeGb !== null ? Number((totalGb - freeGb).toFixed(1)) : null,
      // "Composite Temperature" e' a leitura canonica de um NVMe; as
      // "Temperature #n" sao sensores por chip e nem sempre representativas.
      temperature: this.#pick(leaves, {
        unit: 'C',
        prefer: [/^Composite Temperature$/i, /^Temperature$/i, /^Temperature #1$/i],
        exclude: LibreHardwareMonitorProvider.NOT_A_READING
      })
    };
  }

  #readFans(hardware) {
    const fans = [];
    for (const node of hardware) {
      for (const leaf of this.#flatten(node)) {
        if (leaf.unit === 'RPM' && leaf.value) {
          fans.push({ name: `${String(node.Text).trim()} · ${leaf.name}`, rpm: leaf.value });
        }
      }
    }
    return fans;
  }
}
