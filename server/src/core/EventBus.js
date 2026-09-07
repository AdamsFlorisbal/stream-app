import { EventEmitter } from 'node:events';

/**
 * Barramento de eventos da aplicacao.
 * Existe para desacoplar produtores (telemetria, OBS) de consumidores
 * (gateway WebSocket) sem que um conheca o outro.
 */
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(64);
  }

  /**
   * Publica um evento no formato de envelope usado pelo transporte.
   * @param {string} type
   * @param {unknown} payload
   */
  publish(type, payload) {
    this.emit('message', { type, payload, at: Date.now() });
    this.emit(type, payload);
  }

  /**
   * @param {(envelope: { type: string, payload: unknown, at: number }) => void} listener
   * @returns {() => void} funcao de cancelamento
   */
  onAny(listener) {
    this.on('message', listener);
    return () => this.off('message', listener);
  }
}
