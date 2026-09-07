import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';

/**
 * Ponte para o OBS Studio via obs-websocket v5 (embutido no OBS 28+).
 *
 * Mantem um espelho local do estado (cena atual, live, gravacao, mudos) que e'
 * atualizado por eventos em vez de polling. E' isso que permite as teclas do
 * deck acenderem em tempo real quando algo muda no proprio OBS.
 */
export class ObsController {
  /** Estado neutro usado enquanto desconectado. */
  static emptyState() {
    return {
      connected: false,
      obsVersion: null,
      websocketVersion: null,
      lastError: null,
      streaming: false,
      recording: false,
      recordPaused: false,
      virtualCam: false,
      replayBuffer: false,
      studioMode: false,
      currentScene: null,
      previewScene: null,
      scenes: [],
      inputs: [],
      mutes: {},
      volumes: {}
    };
  }

  #obs;
  #bus;
  #logger;
  #settings;
  #state = ObsController.emptyState();
  #reconnectTimer = null;
  #connecting = false;
  #disposed = false;

  /**
   * @param {object} deps
   * @param {import('../config/AppConfig.js').AppConfig} deps.config
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ config, bus, logger }) {
    this.#obs = new OBSWebSocket();
    this.#bus = bus;
    this.#logger = logger.child('obs');
    this.#settings = config.obs;
    this.#wireEvents();
  }

  get state() {
    return this.#state;
  }

  get isConnected() {
    return this.#state.connected;
  }

  /** Reaplica as configuracoes e reconecta com os novos valores. */
  async reconfigure(settings) {
    this.#settings = settings;
    await this.disconnect();
    if (settings.enabled) void this.connect();
  }

  async connect() {
    if (this.#disposed || this.#connecting || this.#state.connected) return this.#state;
    if (!this.#settings.enabled) return this.#state;

    this.#connecting = true;
    const address = `ws://${this.#settings.host}:${this.#settings.port}`;
    try {
      const { obsWebSocketVersion, negotiatedRpcVersion } = await this.#obs.connect(
        address,
        this.#settings.password || undefined,
        { eventSubscriptions: EventSubscription.All, rpcVersion: 1 }
      );
      this.#logger.info(`conectado em ${address} (rpc ${negotiatedRpcVersion})`);
      this.#state.connected = true;
      this.#state.websocketVersion = obsWebSocketVersion;
      this.#state.lastError = null;
      await this.refresh();
      this.#publish();
    } catch (err) {
      this.#state.connected = false;
      this.#state.lastError = ObsController.#humanize(err);
      this.#logger.debug(`nao conectou: ${this.#state.lastError}`);
      this.#publish();
      this.#scheduleReconnect();
    } finally {
      this.#connecting = false;
    }
    return this.#state;
  }

  async disconnect() {
    this.#clearReconnect();
    if (this.#state.connected) await this.#obs.disconnect().catch(() => {});
    this.#state = { ...ObsController.emptyState(), lastError: this.#state.lastError };
    this.#publish();
  }

  async dispose() {
    this.#disposed = true;
    await this.disconnect();
  }

  /** Recarrega o estado completo do OBS (na conexao e sob demanda). */
  async refresh() {
    if (!this.#state.connected) return this.#state;
    const safe = async (fn, fallback) => {
      try { return await fn(); } catch { return fallback; }
    };

    const [version, sceneList, streamStatus, recordStatus, virtualCam, studio, inputList] = await Promise.all([
      safe(() => this.#obs.call('GetVersion'), null),
      safe(() => this.#obs.call('GetSceneList'), { scenes: [], currentProgramSceneName: null, currentPreviewSceneName: null }),
      safe(() => this.#obs.call('GetStreamStatus'), { outputActive: false }),
      safe(() => this.#obs.call('GetRecordStatus'), { outputActive: false, outputPaused: false }),
      safe(() => this.#obs.call('GetVirtualCamStatus'), { outputActive: false }),
      safe(() => this.#obs.call('GetStudioModeEnabled'), { studioModeEnabled: false }),
      safe(() => this.#obs.call('GetInputList'), { inputs: [] })
    ]);

    this.#state.obsVersion = version?.obsVersion ?? null;
    // O OBS devolve as cenas em ordem inversa (indice 0 = ultima na interface).
    this.#state.scenes = (sceneList.scenes ?? []).map((s) => String(s.sceneName)).reverse();
    this.#state.currentScene = sceneList.currentProgramSceneName ?? null;
    this.#state.previewScene = sceneList.currentPreviewSceneName ?? null;
    this.#state.streaming = Boolean(streamStatus.outputActive);
    this.#state.recording = Boolean(recordStatus.outputActive);
    this.#state.recordPaused = Boolean(recordStatus.outputPaused);
    this.#state.virtualCam = Boolean(virtualCam.outputActive);
    this.#state.studioMode = Boolean(studio.studioModeEnabled);
    this.#state.inputs = (inputList.inputs ?? []).map((i) => String(i.inputName));

    // Estado de audio de cada entrada, para as teclas de mudo acenderem certo.
    await Promise.all(this.#state.inputs.map(async (inputName) => {
      const mute = await safe(() => this.#obs.call('GetInputMute', { inputName }), null);
      if (mute) this.#state.mutes[inputName] = Boolean(mute.inputMuted);
      const volume = await safe(() => this.#obs.call('GetInputVolume', { inputName }), null);
      if (volume) {
        this.#state.volumes[inputName] = {
          mul: volume.inputVolumeMul,
          db: volume.inputVolumeDb,
          percent: ObsController.mulToPercent(volume.inputVolumeMul)
        };
      }
    }));

    return this.#state;
  }

  // --- Acoes -------------------------------------------------------------

  async setScene(sceneName) {
    this.#assertConnected();
    if (!sceneName) throw new Error('informe o nome da cena');
    await this.#obs.call('SetCurrentProgramScene', { sceneName });
    return { sceneName };
  }

  async setPreviewScene(sceneName) {
    this.#assertConnected();
    await this.#obs.call('SetCurrentPreviewScene', { sceneName });
    return { sceneName };
  }

  async toggleStream() {
    this.#assertConnected();
    const { outputActive } = await this.#obs.call('ToggleStream');
    return { streaming: outputActive };
  }

  async toggleRecord() {
    this.#assertConnected();
    const { outputActive } = await this.#obs.call('ToggleRecord');
    return { recording: outputActive };
  }

  async toggleRecordPause() {
    this.#assertConnected();
    await this.#obs.call('ToggleRecordPause');
    return { recordPaused: !this.#state.recordPaused };
  }

  async toggleVirtualCam() {
    this.#assertConnected();
    const { outputActive } = await this.#obs.call('ToggleVirtualCam');
    return { virtualCam: outputActive };
  }

  async toggleReplayBuffer() {
    this.#assertConnected();
    const { outputActive } = await this.#obs.call('ToggleReplayBuffer');
    return { replayBuffer: outputActive };
  }

  async saveReplayBuffer() {
    this.#assertConnected();
    await this.#obs.call('SaveReplayBuffer');
    return { saved: true };
  }

  /** @param {string} inputName @param {'toggle'|'on'|'off'} mode */
  async setInputMute(inputName, mode = 'toggle') {
    this.#assertConnected();
    if (mode === 'toggle') {
      const { inputMuted } = await this.#obs.call('ToggleInputMute', { inputName });
      return { inputName, muted: inputMuted };
    }
    const inputMuted = mode === 'on';
    await this.#obs.call('SetInputMute', { inputName, inputMuted });
    return { inputName, muted: inputMuted };
  }

  /** @param {string} inputName @param {number} percent 0-100 */
  async setInputVolume(inputName, percent) {
    this.#assertConnected();
    const inputVolumeMul = ObsController.percentToMul(percent);
    await this.#obs.call('SetInputVolume', { inputName, inputVolumeMul });
    return { inputName, percent: ObsController.mulToPercent(inputVolumeMul) };
  }

  async getInputVolume(inputName) {
    this.#assertConnected();
    const { inputVolumeMul, inputVolumeDb } = await this.#obs.call('GetInputVolume', { inputName });
    return { inputName, mul: inputVolumeMul, db: inputVolumeDb, percent: ObsController.mulToPercent(inputVolumeMul) };
  }

  /**
   * Liga/desliga uma fonte dentro de uma cena. O OBS trabalha com ids
   * numericos de item, entao o nome precisa ser resolvido antes.
   */
  async setSourceVisible(sceneName, sourceName, mode = 'toggle') {
    this.#assertConnected();
    const scene = sceneName || this.#state.currentScene;
    if (!scene) throw new Error('nenhuma cena ativa');
    const { sceneItemId } = await this.#obs.call('GetSceneItemId', { sceneName: scene, sourceName });
    let enabled;
    if (mode === 'toggle') {
      const current = await this.#obs.call('GetSceneItemEnabled', { sceneName: scene, sceneItemId });
      enabled = !current.sceneItemEnabled;
    } else {
      enabled = mode === 'on';
    }
    await this.#obs.call('SetSceneItemEnabled', { sceneName: scene, sceneItemId, sceneItemEnabled: enabled });
    return { sceneName: scene, sourceName, visible: enabled };
  }

  async setFilterEnabled(sourceName, filterName, mode = 'toggle') {
    this.#assertConnected();
    let enabled;
    if (mode === 'toggle') {
      const current = await this.#obs.call('GetSourceFilter', { sourceName, filterName });
      enabled = !current.filterEnabled;
    } else {
      enabled = mode === 'on';
    }
    await this.#obs.call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: enabled });
    return { sourceName, filterName, enabled };
  }

  async triggerTransition() {
    this.#assertConnected();
    await this.#obs.call('TriggerStudioModeTransition');
    return { transitioned: true };
  }

  async setStudioMode(mode = 'toggle') {
    this.#assertConnected();
    const studioModeEnabled = mode === 'toggle' ? !this.#state.studioMode : mode === 'on';
    await this.#obs.call('SetStudioModeEnabled', { studioModeEnabled });
    return { studioMode: studioModeEnabled };
  }

  // --- Conversao de volume ------------------------------------------------

  /**
   * O OBS usa multiplicador linear de amplitude (0..1), mas o slider da sua
   * interface e' logaritmico. A curva de potencia 3 aproxima o comportamento
   * do fader do proprio OBS, deixando o gesto no knob parecer natural.
   */
  static percentToMul(percent) {
    const clamped = Math.max(0, Math.min(100, Number(percent))) / 100;
    return Number((clamped ** 3).toFixed(6));
  }

  static mulToPercent(mul) {
    const value = Math.max(0, Number(mul) || 0);
    return Math.round(value ** (1 / 3) * 100);
  }

  // --- Interno ------------------------------------------------------------

  #assertConnected() {
    if (!this.#state.connected) throw new Error('OBS nao esta conectado');
  }

  #wireEvents() {
    const bind = (event, handler) => {
      this.#obs.on(event, (data) => {
        try {
          handler(data);
          this.#publish();
        } catch (err) {
          this.#logger.warn(`erro no evento ${event}: ${err.message}`);
        }
      });
    };

    bind('CurrentProgramSceneChanged', (d) => { this.#state.currentScene = d.sceneName; });
    bind('CurrentPreviewSceneChanged', (d) => { this.#state.previewScene = d.sceneName; });
    bind('SceneListChanged', (d) => {
      this.#state.scenes = (d.scenes ?? []).map((s) => String(s.sceneName)).reverse();
    });
    bind('StreamStateChanged', (d) => { this.#state.streaming = Boolean(d.outputActive); });
    bind('RecordStateChanged', (d) => {
      this.#state.recording = Boolean(d.outputActive);
      this.#state.recordPaused = d.outputState === 'OBS_WEBSOCKET_OUTPUT_PAUSED';
    });
    bind('VirtualcamStateChanged', (d) => { this.#state.virtualCam = Boolean(d.outputActive); });
    bind('ReplayBufferStateChanged', (d) => { this.#state.replayBuffer = Boolean(d.outputActive); });
    bind('StudioModeStateChanged', (d) => { this.#state.studioMode = Boolean(d.studioModeEnabled); });
    bind('InputMuteStateChanged', (d) => { this.#state.mutes[d.inputName] = Boolean(d.inputMuted); });
    bind('InputVolumeChanged', (d) => {
      this.#state.volumes[d.inputName] = {
        mul: d.inputVolumeMul,
        db: d.inputVolumeDb,
        percent: ObsController.mulToPercent(d.inputVolumeMul)
      };
    });
    bind('InputCreated', (d) => {
      if (!this.#state.inputs.includes(d.inputName)) this.#state.inputs.push(d.inputName);
    });
    bind('InputRemoved', (d) => {
      this.#state.inputs = this.#state.inputs.filter((name) => name !== d.inputName);
      delete this.#state.mutes[d.inputName];
      delete this.#state.volumes[d.inputName];
    });

    this.#obs.on('ConnectionClosed', (err) => {
      if (!this.#state.connected) return;
      this.#logger.warn(`conexao encerrada: ${ObsController.#humanize(err)}`);
      this.#state = { ...ObsController.emptyState(), lastError: ObsController.#humanize(err) };
      this.#publish();
      this.#scheduleReconnect();
    });

    // Sem este listener o obs-websocket-js emite um 'error' nao tratado, que
    // derrubaria o processo Node inteiro quando o OBS fecha.
    this.#obs.on('ConnectionError', (err) => {
      this.#state.lastError = ObsController.#humanize(err);
      this.#logger.debug(`erro de conexao: ${this.#state.lastError}`);
    });
  }

  #scheduleReconnect() {
    if (this.#disposed || this.#reconnectTimer || !this.#settings.enabled) return;
    const delay = this.#settings.autoReconnectMs ?? 5000;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.connect();
    }, delay);
    this.#reconnectTimer.unref?.();
  }

  #clearReconnect() {
    if (!this.#reconnectTimer) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #publish() {
    this.#bus.publish('obs', this.#state);
  }

  static #humanize(err) {
    if (!err) return null;
    const message = err.message ?? String(err);
    if (/ECONNREFUSED/i.test(message)) return 'OBS fechado ou servidor WebSocket desativado';
    if (/authentication/i.test(message)) return 'senha do obs-websocket incorreta';
    return message;
  }
}
