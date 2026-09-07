import { ActionHandler, ActionError } from '../ActionHandler.js';

/** Navegacao do proprio deck e macros (varias acoes em sequencia). */
export class DeckActionHandler extends ActionHandler {
  /** Teto de aninhamento de macros — impede recursao infinita. */
  static MAX_MACRO_DEPTH = 4;

  /** Teto de passos por macro, para uma tecla nao travar o deck. */
  static MAX_MACRO_STEPS = 25;

  static get types() {
    return ['deck.page', 'deck.profile', 'deck.macro', 'deck.delay'];
  }

  async execute(type, params, meta) {
    const { profiles, bus, registry } = this.context;

    switch (type) {
      case 'deck.page': {
        const page = profiles.setActivePage(String(params.target ?? 'next'));
        bus.publish('deck:page', { pageId: page.id, profileId: profiles.activeProfile.id });
        return { pageId: page.id, name: page.name };
      }

      case 'deck.profile': {
        const profile = profiles.setActiveProfile(this.require(params, 'profileId'));
        bus.publish('deck:profile', { profileId: profile.id, pageId: profiles.activePage?.id ?? null });
        return { profileId: profile.id, name: profile.name };
      }

      case 'deck.delay':
        await DeckActionHandler.#sleep(Number(params.ms ?? 200));
        return { waited: Number(params.ms ?? 200) };

      case 'deck.macro': {
        const steps = params.steps;
        if (!Array.isArray(steps) || steps.length === 0) {
          throw new ActionError('a macro nao tem passos', 'invalid');
        }
        if (steps.length > DeckActionHandler.MAX_MACRO_STEPS) {
          throw new ActionError(`a macro excede ${DeckActionHandler.MAX_MACRO_STEPS} passos`, 'invalid');
        }

        const depth = Number(meta.depth ?? 0);
        if (depth >= DeckActionHandler.MAX_MACRO_DEPTH) {
          throw new ActionError('macros aninhadas demais', 'invalid');
        }

        const results = [];
        for (const [index, step] of steps.entries()) {
          try {
            results.push(await registry.execute(step, { ...meta, depth: depth + 1 }));
          } catch (err) {
            if (params.continueOnError) {
              results.push({ ok: false, step: index, error: err.message });
              continue;
            }
            throw new ActionError(`passo ${index + 1} (${step.type}): ${err.message}`, err.code ?? 'failed');
          }
          const gap = Number(params.gapMs ?? 80);
          if (gap > 0 && index < steps.length - 1) await DeckActionHandler.#sleep(gap);
        }
        return { steps: results.length, results };
      }

      default:
        throw new ActionError(`tipo nao tratado: ${type}`, 'invalid');
    }
  }

  static #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(5000, ms))));
  }

  describe() {
    return [
      {
        type: 'deck.page',
        label: 'Ir para outra pagina',
        group: 'Deck',
        icon: 'pages',
        fields: [
          { key: 'target', label: 'Pagina', type: 'deck-page', default: 'next', required: true }
        ]
      },
      {
        type: 'deck.profile',
        label: 'Trocar de perfil',
        group: 'Deck',
        icon: 'layers',
        fields: [{ key: 'profileId', label: 'Perfil', type: 'deck-profile', required: true }]
      },
      {
        type: 'deck.macro',
        label: 'Macro (varias acoes)',
        group: 'Deck',
        icon: 'sparkles',
        fields: [
          { key: 'steps', label: 'Passos', type: 'macro', required: true },
          { key: 'gapMs', label: 'Pausa entre passos (ms)', type: 'number', min: 0, max: 5000, default: 80 },
          { key: 'continueOnError', label: 'Continuar se um passo falhar', type: 'boolean', default: false }
        ]
      },
      {
        type: 'deck.delay',
        label: 'Esperar',
        group: 'Deck',
        icon: 'clock',
        fields: [{ key: 'ms', label: 'Milissegundos', type: 'number', min: 0, max: 5000, default: 500 }]
      }
    ];
  }
}
