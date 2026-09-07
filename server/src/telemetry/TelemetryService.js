import { SensorSnapshot } from './SensorSnapshot.js';

/**
 * Orquestra os provedores de sensores e publica leituras periodicas.
 *
 * Estrategia de mesclagem: as origens sao lidas em paralelo e combinadas por
 * prioridade decrescente. A de maior prioridade define os valores; as demais
 * apenas preenchem lacunas. Assim o LibreHardwareMonitor manda nas
 * temperaturas enquanto o WMI ainda contribui com disco e rede.
 */
export class TelemetryService {
  #providers = [];
  #bus;
  #logger;
  #intervalMs;
  #timer = null;
  #reading = false;
  #latest = SensorSnapshot.empty();
  #history = [];
  #historyLimit;

  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/Logger.js').Logger} deps.logger
   * @param {number} [deps.intervalMs]
   * @param {number} [deps.historyLimit] Amostras mantidas para os graficos.
   */
  constructor({ bus, logger, intervalMs = 1000, historyLimit = 120 }) {
    this.#bus = bus;
    this.#logger = logger.child('telemetry');
    this.#intervalMs = Math.max(250, intervalMs);
    this.#historyLimit = historyLimit;
  }

  /** @param {import('./SensorProvider.js').SensorProvider} provider */
  register(provider) {
    this.#providers.push(provider);
    this.#providers.sort((a, b) => b.priority - a.priority);
    return this;
  }

  get latest() {
    return this.#latest;
  }

  get history() {
    return this.#history;
  }

  get providers() {
    return this.#providers;
  }

  /** Testa cada origem uma vez e registra quais responderam. */
  async probeAll() {
    const results = await Promise.all(
      this.#providers.map(async (provider) => ({ provider, ok: await provider.probe().catch(() => false) }))
    );
    for (const { provider, ok } of results) {
      this.#logger.info(`${provider.name}: ${ok ? 'disponivel' : 'indisponivel'}`);
    }
    return results.filter((r) => r.ok).map((r) => r.provider.name);
  }

  start() {
    if (this.#timer) return this;
    this.#logger.info(`polling a cada ${this.#intervalMs}ms`);
    this.#timer = setInterval(() => this.tick(), this.#intervalMs);
    this.#timer.unref?.();
    void this.tick();
    return this;
  }

  stop() {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /** @param {number} intervalMs */
  setInterval(intervalMs) {
    this.#intervalMs = Math.max(250, intervalMs);
    if (this.#timer) {
      this.stop();
      this.start();
    }
  }

  /** Uma rodada de leitura. Reentrancia e' ignorada: leituras nao se acumulam. */
  async tick() {
    if (this.#reading) return this.#latest;
    this.#reading = true;
    try {
      const snapshots = await Promise.all(this.#providers.map((provider) => provider.safeRead()));
      const valid = snapshots.filter(Boolean);
      if (valid.length === 0) {
        this.#bus.publish('telemetry:unavailable', { providers: this.#providers.map((p) => p.toStatusJSON()) });
        return this.#latest;
      }

      // `snapshots` segue a ordem de `#providers`, ja ordenada por prioridade.
      const merged = valid.reduce((acc, snapshot) => acc.mergedWith(snapshot));
      this.#latest = merged;
      this.#pushHistory(merged);
      this.#bus.publish('telemetry', merged.toJSON());
      return merged;
    } finally {
      this.#reading = false;
    }
  }

  #pushHistory(snapshot) {
    this.#history.push({
      at: snapshot.at,
      cpu: snapshot.cpu.load,
      gpu: snapshot.gpu.load,
      memory: snapshot.memory.percent,
      cpuTemp: snapshot.cpu.temperature,
      gpuTemp: snapshot.gpu.temperature
    });
    if (this.#history.length > this.#historyLimit) {
      this.#history.splice(0, this.#history.length - this.#historyLimit);
    }
  }

  toStatusJSON() {
    return {
      intervalMs: this.#intervalMs,
      running: Boolean(this.#timer),
      providers: this.#providers.map((provider) => provider.toStatusJSON()),
      latest: this.#latest.toJSON()
    };
  }
}
