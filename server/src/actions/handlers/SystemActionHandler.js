import { ActionHandler, ActionError } from '../ActionHandler.js';

/** Programas, links, volume do Windows, brilho e energia. */
export class SystemActionHandler extends ActionHandler {
  static get types() {
    return [
      'launch',
      'url',
      'volume.set',
      'volume.adjust',
      'volume.mute',
      'display.brightness.set',
      'display.brightness.adjust',
      'system.lock',
      'system.sleep',
      'system.monitors.off'
    ];
  }

  async execute(type, params) {
    const { system, audio } = this.context;

    switch (type) {
      case 'launch':
        return system.launch(this.require(params, 'target'), {
          args: params.args ? String(params.args).split(/\s+/).filter(Boolean) : undefined,
          workingDirectory: params.workingDirectory || undefined
        });

      case 'url':
        return system.openUrl(this.require(params, 'value'));

      case 'volume.set':
        return audio.set(params.device ?? 'output', this.require(params, 'level'));

      case 'volume.adjust':
        return audio.adjust(params.device ?? 'output', this.require(params, 'delta'));

      case 'volume.mute':
        return audio.mute(params.device ?? 'output', params.muted ?? null);

      case 'display.brightness.set':
        return system.setBrightness(this.require(params, 'level'));

      case 'display.brightness.adjust': {
        const current = await system.getBrightness();
        if (current === null) {
          throw new ActionError('este monitor nao aceita controle de brilho por software', 'unavailable');
        }
        return system.setBrightness(current + Number(params.delta ?? 10));
      }

      case 'system.lock':
        return system.lockWorkstation();

      case 'system.sleep':
        return system.sleep();

      case 'system.monitors.off':
        return system.monitorsOff();

      default:
        throw new ActionError(`tipo nao tratado: ${type}`, 'invalid');
    }
  }

  describe() {
    const deviceField = {
      key: 'device',
      label: 'Dispositivo',
      type: 'select',
      default: 'output',
      options: [
        { value: 'output', label: 'Saida (fones/caixas)' },
        { value: 'input', label: 'Entrada (microfone)' }
      ]
    };

    return [
      {
        type: 'launch',
        label: 'Abrir programa',
        group: 'Sistema',
        icon: 'terminal',
        fields: [
          { key: 'target', label: 'Executavel ou caminho', type: 'text', placeholder: 'notepad.exe', required: true },
          { key: 'args', label: 'Argumentos', type: 'text', placeholder: 'opcional' }
        ]
      },
      {
        type: 'url',
        label: 'Abrir link',
        group: 'Sistema',
        icon: 'browser',
        fields: [
          { key: 'value', label: 'URL', type: 'text', placeholder: 'https://twitch.tv', required: true }
        ]
      },
      {
        type: 'volume.set',
        label: 'Definir volume',
        group: 'Audio',
        icon: 'speaker',
        fields: [
          deviceField,
          { key: 'level', label: 'Nivel (%)', type: 'number', min: 0, max: 100, default: 50, required: true }
        ]
      },
      {
        type: 'volume.adjust',
        label: 'Aumentar/diminuir volume',
        group: 'Audio',
        icon: 'speaker',
        fields: [
          deviceField,
          { key: 'delta', label: 'Variacao (%)', type: 'number', min: -100, max: 100, default: 5, required: true }
        ]
      },
      {
        type: 'volume.mute',
        label: 'Mudo',
        group: 'Audio',
        icon: 'speaker-off',
        fields: [
          deviceField,
          {
            key: 'muted',
            label: 'Modo',
            type: 'select',
            default: null,
            options: [
              { value: null, label: 'Alternar' },
              { value: true, label: 'Sempre mudo' },
              { value: false, label: 'Sempre com som' }
            ]
          }
        ]
      },
      {
        type: 'display.brightness.set',
        label: 'Definir brilho',
        group: 'Sistema',
        icon: 'sun',
        note: 'Funciona em telas internas (notebooks) e alguns monitores com DDC/CI.',
        fields: [{ key: 'level', label: 'Brilho (%)', type: 'number', min: 0, max: 100, default: 70, required: true }]
      },
      {
        type: 'display.brightness.adjust',
        label: 'Aumentar/diminuir brilho',
        group: 'Sistema',
        icon: 'sun',
        fields: [{ key: 'delta', label: 'Variacao (%)', type: 'number', min: -100, max: 100, default: 10 }]
      },
      { type: 'system.lock', label: 'Bloquear o computador', group: 'Sistema', icon: 'lock', fields: [] },
      { type: 'system.sleep', label: 'Suspender o computador', group: 'Sistema', icon: 'power', fields: [] },
      { type: 'system.monitors.off', label: 'Desligar os monitores', group: 'Sistema', icon: 'monitor', fields: [] }
    ];
  }
}
