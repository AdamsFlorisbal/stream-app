import os from 'node:os';
import { HttpError } from './HttpServer.js';
import { DiscoveryBeacon } from './DiscoveryBeacon.js';

/**
 * Define as rotas HTTP e traduz os servicos do dominio em JSON.
 *
 * Concentrar as rotas em uma classe mantem o {@link HttpServer} generico —
 * ele so' sabe de seguranca, corpo e despacho, nunca do que o deck faz.
 */
export class ApiController {
  #deps;

  /**
   * @param {object} deps
   * @param {import('./Router.js').Router} deps.router
   * @param {import('../config/AppConfig.js').AppConfig} deps.config
   * @param {import('../config/ProfileStore.js').ProfileStore} deps.profiles
   * @param {import('../actions/ActionRegistry.js').ActionRegistry} deps.registry
   * @param {import('../telemetry/TelemetryService.js').TelemetryService} deps.telemetry
   * @param {import('../integrations/ObsController.js').ObsController} deps.obs
   * @param {import('../platform/WindowManager.js').WindowManager} deps.windows
   * @param {import('../platform/AudioMixer.js').AudioMixer} deps.audio
   * @param {import('../platform/SystemControl.js').SystemControl} deps.system
   * @param {import('../media/MediaLibrary.js').MediaLibrary} deps.media
   * @param {import('./UsbBridge.js').UsbBridge} deps.usb
   * @param {() => object} deps.gatewayInfo
   */
  constructor(deps) {
    this.#deps = deps;
  }

  /** Registra tudo no roteador. @returns {import('./Router.js').Router} */
  register() {
    const { router } = this.#deps;

    router.get('/api/health', () => this.health());
    router.get('/api/state', () => this.snapshot());

    router.get('/api/config', () => ({ ok: true, config: this.#deps.config.toPublicJSON() }));
    router.patch('/api/config', ({ body }) => this.updateConfig(body));

    router.get('/api/profiles', () => ({ ok: true, ...this.#deps.profiles.toClientJSON() }));
    router.put('/api/profiles/active', ({ body }) => this.setActive(body));
    router.post('/api/profiles/:profileId/pages', ({ params, body }) => this.addPage(params, body));
    router.delete('/api/profiles/:profileId/pages/:pageId', ({ params }) => this.removePage(params));
    router.put('/api/profiles/:profileId/pages/:pageId/buttons', ({ params, body }) => this.upsertButton(params, body));
    router.put('/api/profiles/:profileId/pages/:pageId/dials', ({ params, body }) => this.upsertDial(params, body));
    router.post('/api/profiles/:profileId/pages/:pageId/swap', ({ params, body }) => this.swap(params, body));
    router.delete('/api/buttons/:buttonId', ({ params }) => this.removeButton(params));

    router.get('/api/actions/catalog', () => ({ ok: true, catalog: this.#deps.registry.catalog() }));
    router.post('/api/actions/execute', ({ body }) => this.execute(body));
    router.post('/api/buttons/:buttonId/press', ({ params, body }) => this.pressButton(params, body));
    router.get('/api/dials', () => this.readDials());
    router.get('/api/dials/:dialId', ({ params }) => this.readDial(params.dialId));
    router.post('/api/dials/:dialId/rotate', ({ params, body }) => this.rotateDial(params, body));

    router.get('/api/telemetry', () => this.telemetry());
    router.get('/api/windows', ({ query }) => this.listWindows(query));
    router.get('/api/obs', () => ({ ok: true, obs: this.#deps.obs.state }));
    router.post('/api/obs/reconnect', () => this.reconnectObs());

    router.get('/api/media', async () => ({ ok: true, media: await this.#deps.media.list() }));
    router.post('/api/media', ({ req, body, query }) => this.uploadMedia(req, body, query));
    router.delete('/api/media/:name', ({ params }) => this.#deps.media.remove(params.name).then((r) => ({ ok: true, ...r })));

    router.get('/api/usb', () => ({ ok: true, usb: this.#deps.usb.state }));
    router.post('/api/usb/sync', async () => ({ ok: true, usb: await this.#deps.usb.sync() }));

    return router;
  }

  health() {
    return {
      ok: true,
      service: 'deck-control',
      version: 1,
      hostname: os.hostname(),
      uptimeSeconds: Math.round(process.uptime())
    };
  }

  /** Estado completo enviado no boot do aplicativo e a cada reconexao. */
  async snapshot() {
    const { config, profiles, registry, telemetry, obs, media, usb, gatewayInfo } = this.#deps;
    return {
      ok: true,
      server: {
        hostname: os.hostname(),
        addresses: DiscoveryBeacon.localAddresses(),
        port: config.server.port,
        uptimeSeconds: Math.round(process.uptime()),
        clients: gatewayInfo()
      },
      config: config.toPublicJSON(),
      deck: profiles.toClientJSON(),
      catalog: registry.catalog(),
      telemetry: telemetry.toStatusJSON(),
      obs: obs.state,
      usb: usb.state,
      media: await media.list()
    };
  }

  updateConfig(body) {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'corpo invalido');
    const { config, telemetry, obs } = this.#deps;

    // Uma senha mascarada e' um campo que a interface nao editou: preserva-la
    // evita que abrir e salvar as configuracoes apague a senha do OBS.
    if (body.obs?.password === '********') delete body.obs.password;

    config.merge(body);

    if (body.telemetry?.intervalMs) telemetry.setInterval(Number(body.telemetry.intervalMs));
    if (body.obs) void obs.reconfigure(config.obs);

    return { ok: true, config: config.toPublicJSON() };
  }

  setActive(body) {
    const { profiles, bus } = this.#deps;
    if (body?.profileId) profiles.setActiveProfile(body.profileId);
    if (body?.pageId) profiles.setActivePage(body.pageId);
    const state = profiles.toClientJSON();
    bus.publish('deck:changed', state);
    return { ok: true, ...state };
  }

  addPage({ profileId }, body) {
    const page = this.#deps.profiles.addPage(profileId, {
      name: body?.name ?? 'Nova pagina',
      columns: Number(body?.columns ?? 4),
      rows: Number(body?.rows ?? 3)
    });
    this.#publishDeck();
    return { ok: true, page };
  }

  removePage({ profileId, pageId }) {
    const removed = this.#deps.profiles.removePage(profileId, pageId);
    if (!removed) throw new HttpError(409, 'nao e possivel remover a unica pagina do perfil');
    this.#publishDeck();
    return { ok: true };
  }

  upsertButton({ profileId, pageId }, body) {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'corpo invalido');
    const button = this.#deps.profiles.upsertButton(profileId, pageId, body);
    this.#publishDeck();
    return { ok: true, button };
  }

  upsertDial({ profileId, pageId }, body) {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'corpo invalido');
    const dial = this.#deps.profiles.upsertDial(profileId, pageId, body);
    this.#publishDeck();
    return { ok: true, dial };
  }

  swap({ profileId, pageId }, body) {
    const from = Number(body?.from);
    const to = Number(body?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new HttpError(400, 'informe from e to');
    this.#deps.profiles.swapSlots(profileId, pageId, from, to);
    this.#publishDeck();
    return { ok: true };
  }

  removeButton({ buttonId }) {
    if (!this.#deps.profiles.removeButton(buttonId)) throw new HttpError(404, 'tecla nao encontrada');
    this.#publishDeck();
    return { ok: true };
  }

  async execute(body) {
    if (!body?.action?.type) throw new HttpError(400, 'informe action.type');
    const result = await this.#deps.registry.execute(body.action, {
      source: 'http',
      confirm: body.confirm === true
    });
    return { ok: true, result };
  }

  async pressButton({ buttonId }, body) {
    const found = this.#deps.profiles.findButton(buttonId);
    if (!found) throw new HttpError(404, 'tecla nao encontrada');
    if (!found.button.action?.type) throw new HttpError(409, 'esta tecla nao tem acao configurada');
    const result = await this.#deps.registry.execute(found.button.action, {
      source: 'button',
      confirm: body?.confirm === true
    });
    return { ok: true, buttonId, result };
  }

  /**
   * Le o valor atual de um knob sem alterar nada.
   *
   * Existe porque a interface precisa mostrar o volume real ao abrir a pagina
   * e depois que algo muda por fora (o proprio Windows, um teclado com roda).
   * Sem esta rota o cliente teria de "escrever zero" para conseguir ler.
   *
   * @param {string} dialId
   */
  async readDial(dialId) {
    const { profiles, audio, system, obs } = this.#deps;
    const found = profiles.findDial(dialId);
    if (!found) throw new HttpError(404, 'knob nao encontrado');
    const dial = found.dial;

    try {
      switch (dial.kind) {
        case 'volume.output':
        case 'volume.input': {
          const device = dial.kind === 'volume.output' ? 'output' : 'input';
          const result = await audio.get(device);
          return { ok: true, dialId, value: result.level, muted: result.muted, unit: '%' };
        }

        case 'display.brightness': {
          const level = await system.getBrightness();
          return { ok: true, dialId, value: level, unit: '%', available: level !== null };
        }

        case 'obs.input.volume': {
          const inputName = dial.params?.inputName;
          const entry = inputName ? obs.state.volumes[inputName] : null;
          return {
            ok: true,
            dialId,
            value: entry?.percent ?? null,
            muted: inputName ? Boolean(obs.state.mutes[inputName]) : false,
            unit: '%',
            available: Boolean(entry)
          };
        }

        // Um par de atalhos nao tem valor legivel: e' um gesto, nao um nivel.
        case 'hotkey.pair':
          return { ok: true, dialId, value: null, unit: null, available: true };

        default:
          return { ok: true, dialId, value: null, unit: null, available: false };
      }
    } catch (err) {
      return { ok: true, dialId, value: null, unit: null, available: false, error: err.message };
    }
  }

  /** Le todos os knobs da pagina ativa em uma unica ida ao servidor. */
  async readDials() {
    const page = this.#deps.profiles.activePage;
    const dials = page?.dials ?? [];
    const values = await Promise.all(dials.map((dial) => this.readDial(dial.id)));
    return { ok: true, dials: values };
  }

  /**
   * Gira um knob. Cada tipo mapeia para um servico diferente, mas todos
   * respondem no mesmo formato `{ value, unit }` para a interface.
   */
  async rotateDial({ dialId }, body) {
    const { profiles, audio, system, obs } = this.#deps;
    const found = profiles.findDial(dialId);
    if (!found) throw new HttpError(404, 'knob nao encontrado');

    const dial = found.dial;
    const delta = Number(body?.delta ?? 0);
    const absolute = body?.value === undefined || body?.value === null ? null : Number(body.value);

    switch (dial.kind) {
      case 'volume.output':
      case 'volume.input': {
        const device = dial.kind === 'volume.output' ? 'output' : 'input';
        const result = absolute !== null ? await audio.set(device, absolute) : await audio.adjust(device, delta);
        return { ok: true, dialId, value: result.level, unit: '%' };
      }

      case 'display.brightness': {
        const current = await system.getBrightness();
        if (current === null) throw new HttpError(409, 'este monitor nao aceita controle de brilho por software');
        const next = absolute !== null ? absolute : current + delta;
        const result = await system.setBrightness(next);
        return { ok: true, dialId, value: result.brightness, unit: '%' };
      }

      case 'obs.input.volume': {
        const inputName = dial.params?.inputName;
        if (!inputName) throw new HttpError(400, 'o knob nao tem entrada de audio configurada');
        const current = obs.state.volumes[inputName]?.percent ?? 50;
        const next = absolute !== null ? absolute : current + delta;
        const result = await obs.setInputVolume(inputName, next);
        return { ok: true, dialId, value: result.percent, unit: '%' };
      }

      case 'hotkey.pair': {
        const keys = delta >= 0 ? dial.params?.up : dial.params?.down;
        if (!keys) throw new HttpError(400, 'o knob nao tem atalhos configurados');
        // Um giro maior dispara o atalho mais vezes, ate um teto sensato.
        const repeats = Math.min(10, Math.max(1, Math.round(Math.abs(delta) / 5)));
        for (let i = 0; i < repeats; i += 1) await this.#deps.registry.execute({ type: 'hotkey', params: { keys } }, { source: 'dial' });
        return { ok: true, dialId, value: null, unit: null, repeats };
      }

      default:
        throw new HttpError(400, `tipo de knob desconhecido: ${dial.kind}`);
    }
  }

  telemetry() {
    const { telemetry } = this.#deps;
    return { ok: true, telemetry: telemetry.toStatusJSON(), history: telemetry.history };
  }

  async listWindows(query) {
    const windows = await this.#deps.windows.list({
      filter: query.get('filter') || null,
      force: query.get('force') === '1'
    });
    return { ok: true, windows };
  }

  async reconnectObs() {
    const { obs } = this.#deps;
    await obs.disconnect();
    const state = await obs.connect();
    return { ok: true, obs: state };
  }

  async uploadMedia(req, body, query) {
    if (!Buffer.isBuffer(body)) {
      throw new HttpError(400, 'envie o arquivo como corpo binario (Content-Type: application/octet-stream)');
    }
    const saved = await this.#deps.media.save({
      originalName: query.get('name') ?? 'icone',
      contentType: req.headers['x-file-type'] ?? req.headers['content-type'],
      buffer: body
    });
    return { ok: true, media: saved };
  }

  #publishDeck() {
    this.#deps.bus.publish('deck:changed', this.#deps.profiles.toClientJSON());
  }
}
