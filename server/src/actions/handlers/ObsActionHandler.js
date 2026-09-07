import { ActionHandler, ActionError } from '../ActionHandler.js';

/** Controle do OBS Studio: cenas, live, gravacao, fontes, audio e filtros. */
export class ObsActionHandler extends ActionHandler {
  static get types() {
    return [
      'obs.scene',
      'obs.scene.preview',
      'obs.stream.toggle',
      'obs.record.toggle',
      'obs.record.pause',
      'obs.virtualcam.toggle',
      'obs.replay.toggle',
      'obs.replay.save',
      'obs.source.visible',
      'obs.input.mute',
      'obs.input.volume',
      'obs.filter.toggle',
      'obs.transition',
      'obs.studio.toggle',
      'obs.refresh'
    ];
  }

  async execute(type, params) {
    const { obs } = this.context;

    if (!obs.isConnected && type !== 'obs.refresh') {
      throw new ActionError(obs.state.lastError ?? 'OBS nao esta conectado', 'unavailable');
    }

    switch (type) {
      case 'obs.scene':
        return obs.setScene(this.require(params, 'sceneName'));

      case 'obs.scene.preview':
        return obs.setPreviewScene(this.require(params, 'sceneName'));

      case 'obs.stream.toggle':
        return obs.toggleStream();

      case 'obs.record.toggle':
        return obs.toggleRecord();

      case 'obs.record.pause':
        return obs.toggleRecordPause();

      case 'obs.virtualcam.toggle':
        return obs.toggleVirtualCam();

      case 'obs.replay.toggle':
        return obs.toggleReplayBuffer();

      case 'obs.replay.save':
        return obs.saveReplayBuffer();

      case 'obs.source.visible':
        return obs.setSourceVisible(
          params.sceneName || null,
          this.require(params, 'sourceName'),
          params.mode ?? 'toggle'
        );

      case 'obs.input.mute':
        return obs.setInputMute(this.require(params, 'inputName'), params.mode ?? 'toggle');

      case 'obs.input.volume':
        return obs.setInputVolume(this.require(params, 'inputName'), this.require(params, 'percent'));

      case 'obs.filter.toggle':
        return obs.setFilterEnabled(
          this.require(params, 'sourceName'),
          this.require(params, 'filterName'),
          params.mode ?? 'toggle'
        );

      case 'obs.transition':
        return obs.triggerTransition();

      case 'obs.studio.toggle':
        return obs.setStudioMode(params.mode ?? 'toggle');

      case 'obs.refresh':
        // Tenta reconectar antes de recarregar: e' o botao "tentar de novo".
        if (!obs.isConnected) await obs.connect();
        return obs.refresh();

      default:
        throw new ActionError(`tipo nao tratado: ${type}`, 'invalid');
    }
  }

  describe() {
    const modeField = {
      key: 'mode',
      label: 'Modo',
      type: 'select',
      default: 'toggle',
      options: [
        { value: 'toggle', label: 'Alternar' },
        { value: 'on', label: 'Ligar' },
        { value: 'off', label: 'Desligar' }
      ]
    };

    return [
      {
        type: 'obs.scene',
        label: 'Trocar de cena',
        group: 'OBS',
        icon: 'clapper',
        fields: [{ key: 'sceneName', label: 'Cena', type: 'obs-scene', required: true }]
      },
      {
        type: 'obs.scene.preview',
        label: 'Definir cena de preview (modo estudio)',
        group: 'OBS',
        icon: 'clapper',
        fields: [{ key: 'sceneName', label: 'Cena', type: 'obs-scene', required: true }]
      },
      { type: 'obs.stream.toggle', label: 'Iniciar/parar transmissao', group: 'OBS', icon: 'obs', fields: [] },
      { type: 'obs.record.toggle', label: 'Iniciar/parar gravacao', group: 'OBS', icon: 'record', fields: [] },
      { type: 'obs.record.pause', label: 'Pausar/retomar gravacao', group: 'OBS', icon: 'pause', fields: [] },
      { type: 'obs.virtualcam.toggle', label: 'Camera virtual', group: 'OBS', icon: 'camera', fields: [] },
      { type: 'obs.replay.toggle', label: 'Ligar/desligar replay buffer', group: 'OBS', icon: 'rewind', fields: [] },
      { type: 'obs.replay.save', label: 'Salvar replay', group: 'OBS', icon: 'save', fields: [] },
      {
        type: 'obs.source.visible',
        label: 'Mostrar/ocultar fonte',
        group: 'OBS',
        icon: 'eye',
        fields: [
          { key: 'sceneName', label: 'Cena', type: 'obs-scene', placeholder: 'vazio = cena atual' },
          { key: 'sourceName', label: 'Fonte', type: 'text', required: true },
          modeField
        ]
      },
      {
        type: 'obs.input.mute',
        label: 'Mudo de uma entrada de audio',
        group: 'OBS',
        icon: 'mic',
        fields: [{ key: 'inputName', label: 'Entrada', type: 'obs-input', required: true }, modeField]
      },
      {
        type: 'obs.input.volume',
        label: 'Volume de uma entrada de audio',
        group: 'OBS',
        icon: 'speaker',
        fields: [
          { key: 'inputName', label: 'Entrada', type: 'obs-input', required: true },
          { key: 'percent', label: 'Nivel (%)', type: 'number', min: 0, max: 100, default: 80, required: true }
        ]
      },
      {
        type: 'obs.filter.toggle',
        label: 'Ligar/desligar filtro',
        group: 'OBS',
        icon: 'sparkles',
        fields: [
          { key: 'sourceName', label: 'Fonte', type: 'text', required: true },
          { key: 'filterName', label: 'Filtro', type: 'text', required: true },
          modeField
        ]
      },
      { type: 'obs.transition', label: 'Transicao (modo estudio)', group: 'OBS', icon: 'transition', fields: [] },
      { type: 'obs.studio.toggle', label: 'Modo estudio', group: 'OBS', icon: 'layers', fields: [modeField] },
      { type: 'obs.refresh', label: 'Reconectar ao OBS', group: 'OBS', icon: 'refresh', fields: [] }
    ];
  }
}
