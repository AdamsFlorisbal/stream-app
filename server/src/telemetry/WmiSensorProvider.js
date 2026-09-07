import { SensorProvider } from './SensorProvider.js';
import { SensorSnapshot } from './SensorSnapshot.js';

/**
 * Origem de reserva baseada em CIM/WMI, sempre disponivel no Windows.
 *
 * Cobre uso de CPU/GPU, memoria, disco e rede sem instalar nada — o preco e'
 * nao entregar temperatura confiavel: o Windows so' expoe a zona termica ACPI,
 * que muitas placas-mae nem preenchem. Por isso este provedor tem prioridade
 * menor que o {@link LibreHardwareMonitorProvider}, mas continua util para
 * preencher disco e rede, que o LHM nao reporta da mesma forma.
 */
export class WmiSensorProvider extends SensorProvider {
  #host;

  /**
   * @param {object} deps
   * @param {import('../platform/PowerShellHost.js').PowerShellHost} deps.host
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ host, logger }) {
    super({ name: 'wmi', priority: 10, logger });
    this.#host = host;
  }

  async probe() {
    try {
      await this.#host.invoke('ping');
      this.available = true;
      return true;
    } catch (err) {
      this.available = false;
      this.lastError = err.message;
      return false;
    }
  }

  async read() {
    const metrics = await this.#host.invoke('metrics');
    if (!metrics) return null;

    const snapshot = new SensorSnapshot({
      at: Date.now(),
      source: 'wmi',
      cpu: {
        load: metrics.cpu?.load ?? null,
        // Zona termica ACPI: aproximada, e frequentemente ausente.
        temperature: metrics.cpu?.temperature ?? null
      },
      gpu: {
        load: metrics.gpu?.load ?? null,
        memoryUsedMb: metrics.gpu?.memoryMb ?? null
      },
      memory: metrics.memory ?? {},
      disk: metrics.disk ?? {},
      network: metrics.network ?? {},
      uptimeSeconds: metrics.uptimeSeconds ?? null
    });

    return snapshot.isEmpty ? null : snapshot;
  }
}
