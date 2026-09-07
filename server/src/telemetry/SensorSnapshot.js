/**
 * Objeto de valor com uma leitura completa dos sensores.
 *
 * Existe para que a interface receba sempre a mesma forma, independente de a
 * origem ter sido o LibreHardwareMonitor ou o fallback WMI. Campos que a
 * origem nao conseguiu ler ficam `null` — nunca ausentes — para que o cliente
 * possa distinguir "sem sensor" de "ainda carregando".
 */
export class SensorSnapshot {
  static empty() {
    return new SensorSnapshot({});
  }

  constructor(raw = {}) {
    this.at = raw.at ?? Date.now();
    this.source = raw.source ?? 'none';

    this.cpu = {
      name: raw.cpu?.name ?? null,
      load: SensorSnapshot.#num(raw.cpu?.load),
      temperature: SensorSnapshot.#num(raw.cpu?.temperature),
      clockMhz: SensorSnapshot.#num(raw.cpu?.clockMhz),
      powerW: SensorSnapshot.#num(raw.cpu?.powerW)
    };

    this.gpu = {
      name: raw.gpu?.name ?? null,
      load: SensorSnapshot.#num(raw.gpu?.load),
      temperature: SensorSnapshot.#num(raw.gpu?.temperature),
      memoryUsedMb: SensorSnapshot.#num(raw.gpu?.memoryUsedMb),
      memoryTotalMb: SensorSnapshot.#num(raw.gpu?.memoryTotalMb),
      clockMhz: SensorSnapshot.#num(raw.gpu?.clockMhz),
      fanRpm: SensorSnapshot.#num(raw.gpu?.fanRpm),
      powerW: SensorSnapshot.#num(raw.gpu?.powerW)
    };

    this.memory = {
      usedMb: SensorSnapshot.#num(raw.memory?.usedMb),
      totalMb: SensorSnapshot.#num(raw.memory?.totalMb),
      percent: SensorSnapshot.#num(raw.memory?.percent)
    };

    this.disk = {
      usedGb: SensorSnapshot.#num(raw.disk?.usedGb),
      totalGb: SensorSnapshot.#num(raw.disk?.totalGb),
      percent: SensorSnapshot.#num(raw.disk?.percent),
      temperature: SensorSnapshot.#num(raw.disk?.temperature)
    };

    this.network = {
      downKbps: SensorSnapshot.#num(raw.network?.downKbps),
      upKbps: SensorSnapshot.#num(raw.network?.upKbps)
    };

    this.motherboard = {
      name: raw.motherboard?.name ?? null,
      temperature: SensorSnapshot.#num(raw.motherboard?.temperature)
    };

    this.fans = Array.isArray(raw.fans) ? raw.fans : [];
    this.uptimeSeconds = SensorSnapshot.#num(raw.uptimeSeconds);
  }

  static #num(value) {
    // `Number(null)` e' 0 e `Number('')` tambem: sem esta guarda, um sensor
    // ausente viraria "0 °C" na tela em vez de "sem leitura".
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** True quando nao ha nenhum dado util — evita transmitir ruido. */
  get isEmpty() {
    return this.cpu.load === null && this.memory.percent === null && this.gpu.load === null;
  }

  /**
   * Sobrepoe `other` sobre esta leitura, campo a campo, mantendo o valor
   * existente onde o outro for `null`. Usado para combinar o
   * LibreHardwareMonitor (temperaturas) com o WMI (disco, rede).
   * @param {SensorSnapshot} other
   * @returns {SensorSnapshot}
   */
  mergedWith(other) {
    if (!other) return this;
    // `this` e' a leitura de maior prioridade: ela vence sempre que tiver
    // valor, e a outra origem serve apenas para tapar buracos.
    const pick = (mine, theirs) => (mine === null || mine === undefined ? theirs ?? null : mine);
    const mergeGroup = (mine, theirs) => {
      const out = { ...mine };
      for (const key of Object.keys(mine)) out[key] = pick(mine[key], theirs?.[key]);
      return out;
    };

    return new SensorSnapshot({
      at: Math.max(this.at, other.at),
      source: this.source === other.source ? this.source : 'mixed',
      cpu: mergeGroup(this.cpu, other.cpu),
      gpu: mergeGroup(this.gpu, other.gpu),
      memory: mergeGroup(this.memory, other.memory),
      disk: mergeGroup(this.disk, other.disk),
      network: mergeGroup(this.network, other.network),
      motherboard: mergeGroup(this.motherboard, other.motherboard),
      fans: this.fans.length ? this.fans : other.fans,
      uptimeSeconds: pick(this.uptimeSeconds, other.uptimeSeconds)
    });
  }

  toJSON() {
    return {
      at: this.at,
      source: this.source,
      cpu: this.cpu,
      gpu: this.gpu,
      memory: this.memory,
      disk: this.disk,
      network: this.network,
      motherboard: this.motherboard,
      fans: this.fans,
      uptimeSeconds: this.uptimeSeconds
    };
  }
}
