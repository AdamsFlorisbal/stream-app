import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

/**
 * Conexao por cabo USB usando `adb reverse`.
 *
 * `adb reverse tcp:8787 tcp:8787` faz o Android encaminhar a porta local dele
 * para a mesma porta no PC. O tablet passa a acessar `http://127.0.0.1:8787`
 * como se o servidor rodasse nele — sem Wi-Fi, sem IP, com latencia menor e
 * imune a rede instavel.
 *
 * Requisitos no tablet: Depuracao USB ligada em Opcoes do desenvolvedor.
 * O servico vigia a chegada do aparelho e aplica o redirecionamento sozinho.
 */
export class UsbBridge {
  /** Locais onde o adb costuma estar, alem do PATH. */
  static COMMON_PATHS = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(process.env.PROGRAMFILES ?? '', 'Android', 'platform-tools', 'adb.exe'),
    path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'C:\\platform-tools\\adb.exe'
  ];

  #logger;
  #bus;
  #settings;
  #port;
  #toolsDir;
  #adbPath = null;
  #timer = null;
  #state = { adbAvailable: false, adbPath: null, devices: [], bridged: false, lastError: null };

  /**
   * @param {object} deps
   * @param {{ autoBridge: boolean, pollMs: number, adbPath: string|null }} deps.settings
   * @param {number} deps.port Porta HTTP do servidor.
   * @param {import('../config/Paths.js').Paths} deps.paths
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ settings, port, paths, bus, logger }) {
    this.#settings = settings;
    this.#port = port;
    this.#toolsDir = paths.toolsDir;
    this.#bus = bus;
    this.#logger = logger.child('usb');
  }

  get state() {
    return this.#state;
  }

  /** Procura o adb no caminho configurado, no PATH e nos locais conhecidos. */
  async locateAdb() {
    const candidates = [
      this.#settings.adbPath,
      path.join(this.#toolsDir, 'platform-tools', 'adb.exe'),
      ...UsbBridge.COMMON_PATHS
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.#adbPath = candidate;
        return candidate;
      }
    }

    // Ultimo recurso: confiar no PATH.
    try {
      await run('adb', ['version'], { windowsHide: true, timeout: 5000 });
      this.#adbPath = 'adb';
      return 'adb';
    } catch {
      this.#adbPath = null;
      return null;
    }
  }

  async start() {
    const adb = await this.locateAdb();
    this.#state.adbAvailable = Boolean(adb);
    this.#state.adbPath = adb;

    if (!adb) {
      this.#state.lastError = 'adb nao encontrado; instale o Android Platform Tools para usar o cabo USB';
      this.#logger.info('adb ausente — modo USB indisponivel (a conexao por Wi-Fi continua funcionando)');
      this.#publish();
      return this;
    }

    this.#logger.info(`adb encontrado em ${adb}`);
    if (this.#settings.autoBridge) {
      this.#timer = setInterval(() => void this.sync(), Math.max(2000, this.#settings.pollMs));
      this.#timer.unref?.();
      await this.sync();
    }
    return this;
  }

  /** Lista os aparelhos e aplica o `reverse` nos que estiverem autorizados. */
  async sync() {
    if (!this.#adbPath) return this.#state;
    try {
      const devices = await this.listDevices();
      this.#state.devices = devices;

      const ready = devices.filter((d) => d.state === 'device');
      if (ready.length === 0) {
        // Aparelho desconectado: o redirecionamento morre com ele.
        if (this.#state.bridged) {
          this.#state.bridged = false;
          this.#logger.info('aparelho desconectado');
          this.#publish();
        }
        // `authorizing` = o dialogo de permissao esta aberto no tablet agora;
        // `unauthorized` = ele foi recusado ou nunca apareceu.
        if (devices.some((d) => d.state === 'authorizing')) {
          this.#state.lastError = 'toque em "Permitir" na tela do tablet para autorizar este computador';
        } else if (devices.some((d) => d.state === 'unauthorized')) {
          this.#state.lastError = 'aparelho conectado, mas nao autorizado — reconecte o cabo e confirme a permissao de depuracao USB no tablet';
        } else {
          this.#state.lastError = null;
        }
        return this.#state;
      }

      let bridgedAny = false;
      for (const device of ready) {
        try {
          await run(this.#adbPath, ['-s', device.serial, 'reverse', `tcp:${this.#port}`, `tcp:${this.#port}`], {
            windowsHide: true,
            timeout: 8000
          });
          bridgedAny = true;
        } catch (err) {
          this.#logger.warn(`reverse falhou em ${device.serial}: ${UsbBridge.#clean(err)}`);
        }
      }

      if (bridgedAny && !this.#state.bridged) {
        this.#logger.info(`ponte USB ativa — o tablet alcanca http://127.0.0.1:${this.#port}`);
      }
      this.#state.bridged = bridgedAny;
      this.#state.lastError = null;
      this.#publish();
    } catch (err) {
      this.#state.lastError = UsbBridge.#clean(err);
      this.#logger.debug(`sync falhou: ${this.#state.lastError}`);
    }
    return this.#state;
  }

  /** @returns {Promise<Array<{ serial: string, state: string }>>} */
  async listDevices() {
    const { stdout } = await run(this.#adbPath, ['devices'], { windowsHide: true, timeout: 8000 });
    return stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [serial, state] = line.split(/\s+/);
        return { serial, state };
      })
      .filter((device) => device.serial && device.state);
  }

  /** Remove o redirecionamento — usado no desligamento do servidor. */
  async teardown() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (!this.#adbPath || !this.#state.bridged) return;
    await run(this.#adbPath, ['reverse', '--remove', `tcp:${this.#port}`], { windowsHide: true, timeout: 5000 })
      .catch(() => {});
    this.#state.bridged = false;
  }

  #publish() {
    this.#bus.publish('usb', this.#state);
  }

  static #clean(err) {
    const text = (err?.stderr || err?.message || String(err)).trim();
    return text.split(/\r?\n/)[0] || 'erro desconhecido';
  }
}
