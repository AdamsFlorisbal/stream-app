import { ActionHandler, ActionError } from '../ActionHandler.js';

/** Troca de janelas e de areas de trabalho virtuais. */
export class WindowActionHandler extends ActionHandler {
  static get types() {
    return ['window.activate', 'window.minimize', 'window.close', 'window.cycle', 'desktop.switch'];
  }

  async execute(type, params) {
    const { windows } = this.context;

    switch (type) {
      case 'window.activate':
        // `match` casa por nome de processo ou titulo; `handle` e' exato mas
        // so' vale enquanto a janela existir, entao a interface grava `match`.
        return windows.activate({
          handle: params.handle ? Number(params.handle) : undefined,
          match: params.match
        });

      case 'window.minimize':
        return windows.minimize(Number(this.require(params, 'handle')));

      case 'window.close':
        return windows.close(Number(this.require(params, 'handle')));

      case 'window.cycle': {
        // Percorre as janelas do mesmo processo — util quando ha varias
        // instancias do navegador abertas.
        const match = String(this.require(params, 'match')).toLowerCase();
        const all = await windows.list({ force: true });
        const group = all.filter(
          (w) => w.process.toLowerCase().includes(match) || w.title.toLowerCase().includes(match)
        );
        if (group.length === 0) throw new ActionError(`nenhuma janela para "${params.match}"`, 'unavailable');
        const currentIndex = group.findIndex((w) => w.foreground);
        const next = group[(currentIndex + 1) % group.length];
        return windows.activate({ handle: next.handle });
      }

      case 'desktop.switch':
        return windows.switchDesktop(params.direction === 'prev' ? 'prev' : 'next');

      default:
        throw new ActionError(`tipo nao tratado: ${type}`, 'invalid');
    }
  }

  describe() {
    return [
      {
        type: 'window.activate',
        label: 'Focar janela',
        group: 'Janelas',
        icon: 'browser',
        fields: [
          { key: 'match', label: 'Programa ou titulo', type: 'window', placeholder: 'chrome', required: true }
        ]
      },
      {
        type: 'window.cycle',
        label: 'Alternar entre janelas do programa',
        group: 'Janelas',
        icon: 'windows',
        fields: [
          { key: 'match', label: 'Programa', type: 'window', placeholder: 'code', required: true }
        ]
      },
      {
        type: 'desktop.switch',
        label: 'Trocar area de trabalho',
        group: 'Janelas',
        icon: 'desktop',
        fields: [
          {
            key: 'direction',
            label: 'Direcao',
            type: 'select',
            default: 'next',
            options: [
              { value: 'next', label: 'Proxima' },
              { value: 'prev', label: 'Anterior' }
            ]
          }
        ]
      }
    ];
  }
}
