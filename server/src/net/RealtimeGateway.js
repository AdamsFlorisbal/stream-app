import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

/**
 * Canal WebSocket de tempo real.
 *
 * Empurra telemetria, estado do OBS e mudancas de pagina para todos os
 * aparelhos conectados, e aceita comandos de volta. As teclas usam este canal
 * em vez de HTTP porque o toque precisa parecer instantaneo: a conexao ja esta
 * aberta, entao nao ha handshake por clique.
 */
export class RealtimeGateway {
  /** Intervalo do heartbeat: derruba conexoes zumbis (tablet que dormiu). */
  static HEARTBEAT_MS = 25000;

  #wss;
  #bus;
  #logger;
  #registry;
  #clients = new Map();
  #heartbeat = null;
  #snapshotProvider;

  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/Logger.js').Logger} deps.logger
   * @param {import('../actions/ActionRegistry.js').ActionRegistry} deps.registry
   * @param {() => Promise<any>} deps.snapshotProvider Estado inicial enviado a cada cliente.
   */
  constructor({ bus, logger, registry, snapshotProvider }) {
    this.#bus = bus;
    this.#logger = logger.child('ws');
    this.#registry = registry;
    this.#snapshotProvider = snapshotProvider;
    this.#wss = new WebSocketServer({ noServer: true });
  }

  get clientCount() {
    return this.#clients.size;
  }

  /** Liga o gateway ao servidor HTTP e ao barramento de eventos. */
  attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.#wss.handleUpgrade(req, socket, head, (ws) => this.#onConnection(ws, req));
    });

    // Todo evento publicado no barramento vira mensagem para os clientes.
    this.#bus.onAny((envelope) => {
      if (envelope.type.startsWith('internal:')) return;
      this.broadcast(envelope.type, envelope.payload);
    });

    this.#heartbeat = setInterval(() => this.#sweep(), RealtimeGateway.HEARTBEAT_MS);
    this.#heartbeat.unref?.();
    return this;
  }

  async #onConnection(ws, req) {
    const id = randomUUID().slice(0, 8);
    const address = req.socket.remoteAddress ?? 'desconhecido';
    // A ponte USB chega como loopback; util para o app mostrar "via cabo".
    const transport = /^(::1|::ffff:127\.|127\.)/.test(address) ? 'usb-ou-local' : 'rede';

    this.#clients.set(ws, { id, address, transport, alive: true, connectedAt: Date.now() });
    this.#logger.info(`cliente ${id} conectado (${transport}, ${address}) — total ${this.#clients.size}`);

    ws.on('pong', () => {
      const client = this.#clients.get(ws);
      if (client) client.alive = true;
    });

    ws.on('message', (raw) => void this.#onMessage(ws, raw));

    ws.on('close', () => {
      this.#clients.delete(ws);
      this.#logger.info(`cliente ${id} saiu — total ${this.#clients.size}`);
      this.#bus.publish('clients', { count: this.#clients.size });
    });

    ws.on('error', (err) => this.#logger.debug(`cliente ${id}: ${err.message}`));

    try {
      const snapshot = await this.#snapshotProvider();
      this.#send(ws, 'hello', { clientId: id, transport, ...snapshot });
    } catch (err) {
      this.#logger.error('falha ao montar o estado inicial', err.message);
      this.#send(ws, 'error', { message: 'falha ao carregar o estado inicial' });
    }

    this.#bus.publish('clients', { count: this.#clients.size });
  }

  async #onMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      this.#send(ws, 'error', { message: 'mensagem invalida' });
      return;
    }

    const { type, requestId } = message;

    try {
      switch (type) {
        case 'ping':
          this.#send(ws, 'pong', { at: Date.now() }, requestId);
          break;

        case 'action': {
          const result = await this.#registry.execute(message.action, {
            source: 'websocket',
            confirm: message.confirm === true
          });
          this.#send(ws, 'action:result', { ok: true, result }, requestId);
          break;
        }

        default:
          this.#send(ws, 'error', { message: `tipo desconhecido: ${type}` }, requestId);
      }
    } catch (err) {
      this.#send(ws, 'action:result', { ok: false, error: err.message, code: err.code ?? 'failed' }, requestId);
    }
  }

  /**
   * @param {string} type
   * @param {unknown} payload
   */
  broadcast(type, payload) {
    if (this.#clients.size === 0) return;
    const message = JSON.stringify({ type, payload, at: Date.now() });
    for (const [ws] of this.#clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }

  #send(ws, type, payload, requestId) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, payload, requestId, at: Date.now() }));
  }

  /** Fecha conexoes que nao responderam ao ultimo ping. */
  #sweep() {
    for (const [ws, client] of this.#clients) {
      if (!client.alive) {
        this.#logger.debug(`cliente ${client.id} sem resposta; encerrando`);
        ws.terminate();
        this.#clients.delete(ws);
        continue;
      }
      client.alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }

  clientsJSON() {
    return [...this.#clients.values()].map((client) => ({
      id: client.id,
      transport: client.transport,
      address: client.address,
      connectedAt: client.connectedAt
    }));
  }

  async close() {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const [ws] of this.#clients) ws.close(1001, 'servidor encerrando');
    this.#clients.clear();
    await new Promise((resolve) => this.#wss.close(resolve));
  }
}
