import { ActionHandler, ActionError } from '../ActionHandler.js';

/** Atalhos de teclado, digitacao de texto e teclas de midia. */
export class InputActionHandler extends ActionHandler {
  static get types() {
    return ['hotkey', 'text', 'media'];
  }

  async execute(type, params) {
    switch (type) {
      case 'hotkey':
        return this.context.input.hotkey(this.require(params, 'keys'));

      case 'text':
        return this.context.input.type(this.require(params, 'value'));

      case 'media':
        return this.context.input.media(this.require(params, 'key'));

      default:
        throw new ActionError(`tipo nao tratado: ${type}`, 'invalid');
    }
  }

  describe() {
    return [
      {
        type: 'hotkey',
        label: 'Atalho de teclado',
        group: 'Teclado',
        icon: 'keyboard',
        fields: [
          { key: 'keys', label: 'Combinacao', type: 'hotkey', placeholder: 'ctrl+shift+f1', required: true }
        ]
      },
      {
        type: 'text',
        label: 'Digitar texto',
        group: 'Teclado',
        icon: 'type',
        fields: [
          { key: 'value', label: 'Texto', type: 'textarea', placeholder: 'Obrigado pelo follow!', required: true }
        ]
      },
      {
        type: 'media',
        label: 'Tecla de midia',
        group: 'Teclado',
        icon: 'play',
        fields: [
          {
            key: 'key',
            label: 'Tecla',
            type: 'select',
            required: true,
            default: 'playpause',
            options: [
              { value: 'playpause', label: 'Reproduzir / Pausar' },
              { value: 'next', label: 'Proxima faixa' },
              { value: 'prev', label: 'Faixa anterior' },
              { value: 'stop', label: 'Parar' }
            ]
          }
        ]
      }
    ];
  }
}
