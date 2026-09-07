import { randomUUID } from 'node:crypto';

import { rootLogger } from './core/Logger.js';
import { EventBus } from './core/EventBus.js';
import { Paths } from './config/Paths.js';
import { AppConfig } from './config/AppConfig.js';
import { ProfileStore } from './config/ProfileStore.js';

import { PowerShellHost } from './platform/PowerShellHost.js';
import { WindowsInput } from './platform/WindowsInput.js';
import { WindowManager } from './platform/WindowManager.js';
import { AudioMixer } from './platform/AudioMixer.js';
import { SystemControl } from './platform/SystemControl.js';

import { TelemetryService } from './telemetry/TelemetryService.js';
import { LibreHardwareMonitorProvider } from './telemetry/LibreHardwareMonitorProvider.js';
import { WmiSensorProvider } from './telemetry/WmiSensorProvider.js';

import { ObsController } from './integrations/ObsController.js';

import { ActionRegistry } from './actions/ActionRegistry.js';
import { InputActionHandler } from './actions/handlers/InputActionHandler.js';
import { WindowActionHandler } from './actions/handlers/WindowActionHandler.js';
import { SystemActionHandler } from './actions/handlers/SystemActionHandler.js';
import { ObsActionHandler } from './actions/handlers/ObsActionHandler.js';
import { DeckActionHandler } from './actions/handlers/DeckActionHandler.js';

import { MediaLibrary } from './media/MediaLibrary.js';

import { Router } from './net/Router.js';
import { StaticFileHandler } from './net/StaticFileHandler.js';
import { HttpServer } from './net/HttpServer.js';
import { ApiController } from './net/ApiController.js';
import { RealtimeGateway } from './net/RealtimeGateway.js';
import { DiscoveryBeacon } from './net/DiscoveryBeacon.js';
import { UsbBridge } from './net/UsbBridge.js';

/**
 * Raiz de composicao: constroi o grafo de objetos e controla o ciclo de vida.
 *
 * Nenhuma classe do projeto instancia suas proprias dependencias — todas as
 * ligacoes acontecem aqui. Isso mantem cada peca testavel isoladamente e deixa
 * a ordem de inicializacao visivel em um so' lugar.
 */
export class Application {
  #logger = rootLogger;
  #bus = new EventBus();
  #services = {};
  #shuttingDown = false;

  async start() {
    this.#printBanner();

    const paths = new Paths().ensure();
    const config = await new AppConfig({ paths, logger: this.#logger }).load();
    const profiles = await new ProfileStore({ paths, logger: this.#logger }).load();

    // --- Plataforma Windows ------------------------------------------------
    const host = new PowerShellHost({ paths, logger: this.#logger });
    try {
      await host.start();
    } catch (err) {
      // Sem o agente o deck ainda sobe: OBS e interface seguem funcionando, e
      // o agente se reconecta sozinho. Falhar aqui seria pior que degradar.
      this.#logger.error(`agente Windows indisponivel: ${err.message}`);
    }

    const input = new WindowsInput({ host });
    const windows = new WindowManager({ host });
    const audio = new AudioMixer({ host });
    const system = new SystemControl({ host, logger: this.#logger });

    // --- OBS ---------------------------------------------------------------
    const obs = new ObsController({ config, bus: this.#bus, logger: this.#logger });
    void obs.connect();

    // --- Telemetria --------------------------------------------------------
    const telemetry = new TelemetryService({
      bus: this.#bus,
      logger: this.#logger,
      intervalMs: config.telemetry.intervalMs
    });
    if (config.telemetry.preferLibreHardwareMonitor) {
      telemetry.register(new LibreHardwareMonitorProvider({
        url: config.telemetry.libreHardwareMonitorUrl,
        logger: this.#logger
      }));
    }
    telemetry.register(new WmiSensorProvider({ host, logger: this.#logger }));
    const availableSensors = await telemetry.probeAll();
    if (!availableSensors.includes('libre-hardware-monitor')) {
      this.#logger.warn(
        'LibreHardwareMonitor nao detectado — temperatura de CPU/GPU ficara indisponivel. ' +
        'Veja docs/SENSORES.md para ligar em 2 minutos.'
      );
    }
    telemetry.start();

    // --- Acoes -------------------------------------------------------------
    const registry = new ActionRegistry({ logger: this.#logger, bus: this.#bus });
    const context = {
      input, windows, audio, system, obs, profiles,
      bus: this.#bus, logger: this.#logger, registry
    };
    registry
      .register(new InputActionHandler(context))
      .register(new WindowActionHandler(context))
      .register(new SystemActionHandler(context))
      .register(new ObsActionHandler(context))
      .register(new DeckActionHandler(context));
    this.#logger.info(`${registry.types.length} tipos de acao registrados`);

    // --- Midia e rede ------------------------------------------------------
    const media = new MediaLibrary({ paths, logger: this.#logger });
    const router = new Router();
    const staticHandler = new StaticFileHandler({
      roots: { '/media': paths.mediaDir, '/': paths.publicDir },
      logger: this.#logger
    });

    const gateway = new RealtimeGateway({
      bus: this.#bus,
      logger: this.#logger,
      registry,
      snapshotProvider: () => api.snapshot()
    });

    const usb = new UsbBridge({
      settings: config.usb,
      port: config.server.port,
      paths,
      bus: this.#bus,
      logger: this.#logger
    });

    const api = new ApiController({
      router, config, profiles, registry, telemetry, obs,
      windows, audio, system, media, usb,
      bus: this.#bus,
      gatewayInfo: () => gateway.clientsJSON()
    });
    api.register();

    const httpServer = new HttpServer({ router, staticHandler, config, paths, logger: this.#logger });
    await httpServer.listen();
    gateway.attach(httpServer.server);

    const discovery = new DiscoveryBeacon({
      settings: config.discovery,
      httpPort: config.server.port,
      serverId: randomUUID(),
      logger: this.#logger
    });
    await discovery.start();
    await usb.start();

    this.#services = { config, profiles, host, obs, telemetry, httpServer, gateway, discovery, usb };
    this.#installShutdownHooks();
    this.#printReady(config);

    return this;
  }

  #printBanner() {
    console.log('\n\x1b[36m  ██  DECK CONTROL\x1b[0m  ·  servidor de atalhos, OBS e telemetria\n');
  }

  #printReady(config) {
    const port = config.server.port;
    const addresses = DiscoveryBeacon.localAddresses();
    console.log('\n\x1b[32m  Pronto.\x1b[0m Abra no tablet:\n');
    console.log(`    \x1b[1mCabo USB\x1b[0m   http://127.0.0.1:${port}   (requer adb; veja docs/CONEXAO.md)`);
    for (const { interface: iface, address } of addresses) {
      console.log(`    \x1b[1mWi-Fi\x1b[0m      http://${address}:${port}   (${iface})`);
    }
    console.log('');
  }

  #installShutdownHooks() {
    const shutdown = async (signal) => {
      if (this.#shuttingDown) return;
      this.#shuttingDown = true;
      this.#logger.info(`${signal} recebido, encerrando`);

      // Persistir primeiro: perder a configuracao do usuario seria o pior
      // resultado possivel de um desligamento.
      this.#services.config?.flushSync();
      this.#services.profiles?.flushSync();

      const closers = [
        () => this.#services.telemetry?.stop(),
        () => this.#services.usb?.teardown(),
        () => this.#services.discovery?.stop(),
        () => this.#services.gateway?.close(),
        () => this.#services.httpServer?.close(),
        () => this.#services.obs?.dispose(),
        () => this.#services.host?.stop()
      ];
      for (const close of closers) {
        await Promise.resolve().then(close).catch(() => {});
      }

      this.#logger.info('encerrado');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      this.#logger.error('excecao nao tratada', err);
    });
    process.on('unhandledRejection', (reason) => {
      this.#logger.error('promessa rejeitada sem tratamento', reason);
    });
  }
}

const application = new Application();
application.start().catch((err) => {
  console.error('\n\x1b[31mFalha ao iniciar:\x1b[0m', err);
  process.exit(1);
});
