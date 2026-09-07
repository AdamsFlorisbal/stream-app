import { JsonStore } from './JsonStore.js';

/**
 * Configuracao global do servidor (portas, OBS, telemetria, USB).
 * Separada dos perfis porque muda raramente e nao e' exportavel/compartilhavel.
 * @extends {JsonStore<ReturnType<typeof AppConfig.defaults>>}
 */
export class AppConfig extends JsonStore {
  static defaults() {
    return {
      version: 1,
      server: { port: 8787, host: '0.0.0.0' },
      discovery: { enabled: true, port: 8788, serviceName: 'Deck Control' },
      security: { pin: null },
      obs: { enabled: true, host: '127.0.0.1', port: 4455, password: '', autoReconnectMs: 5000 },
      telemetry: {
        intervalMs: 1000,
        preferLibreHardwareMonitor: true,
        libreHardwareMonitorUrl: 'http://127.0.0.1:8085/data.json'
      },
      usb: { autoBridge: true, pollMs: 4000, adbPath: null },
      ui: { accent: '#22d3ee', secondary: '#f472b6', background: 'aurora', showDials: true }
    };
  }

  /** @param {{ paths: import('./Paths.js').Paths, logger: import('../core/Logger.js').Logger }} deps */
  constructor({ paths, logger }) {
    super({ file: paths.settingsFile, defaults: AppConfig.defaults(), logger: logger.child('config') });
  }

  /** Preenche chaves ausentes ao abrir arquivos gravados por versoes antigas. */
  migrate(raw) {
    const base = AppConfig.defaults();
    return {
      ...base,
      ...raw,
      server: { ...base.server, ...raw?.server },
      discovery: { ...base.discovery, ...raw?.discovery },
      security: { ...base.security, ...raw?.security },
      obs: { ...base.obs, ...raw?.obs },
      telemetry: { ...base.telemetry, ...raw?.telemetry },
      usb: { ...base.usb, ...raw?.usb },
      ui: { ...base.ui, ...raw?.ui }
    };
  }

  get server() { return this.data.server; }
  get obs() { return this.data.obs; }
  get telemetry() { return this.data.telemetry; }
  get usb() { return this.data.usb; }
  get discovery() { return this.data.discovery; }
  get ui() { return this.data.ui; }

  /**
   * Mescla um patch parcial de configuracao.
   * @param {Record<string, any>} patch
   */
  merge(patch) {
    return this.update((data) => {
      for (const [section, value] of Object.entries(patch)) {
        if (!(section in data)) continue;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(data[section], value);
        } else {
          data[section] = value;
        }
      }
    });
  }

  /**
   * Visao segura para enviar ao cliente — nunca expoe a senha do OBS nem o PIN.
   */
  toPublicJSON() {
    const { obs, security, ...rest } = this.data;
    return {
      ...rest,
      obs: { ...obs, password: obs.password ? '********' : '' },
      security: { pinEnabled: Boolean(security.pin) }
    };
  }
}
