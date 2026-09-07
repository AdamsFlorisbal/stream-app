import dgram from 'node:dgram';
import os from 'node:os';

/**
 * Descoberta do servidor na rede local por UDP.
 *
 * Responde a sondagens do aplicativo e anuncia sua presenca periodicamente,
 * para que o tablet encontre o PC sem ninguem digitar endereco IP. Usa UDP
 * puro em vez de mDNS/Bonjour de proposito: mDNS depende de servico do sistema
 * que frequentemente esta desativado no Windows, e traria mais dependencias.
 */
export class DiscoveryBeacon {
  /** Token que abre toda sondagem — evita responder a trafego alheio. */
  static PROBE = 'DECK-CONTROL-DISCOVER/1';
  static ANNOUNCE = 'DECK-CONTROL-ANNOUNCE/1';

  #socket = null;
  #logger;
  #settings;
  #httpPort;
  #announceTimer = null;
  #serverId;

  /**
   * @param {object} deps
   * @param {{ enabled: boolean, port: number, serviceName: string }} deps.settings
   * @param {number} deps.httpPort
   * @param {string} deps.serverId
   * @param {import('../core/Logger.js').Logger} deps.logger
   */
  constructor({ settings, httpPort, serverId, logger }) {
    this.#settings = settings;
    this.#httpPort = httpPort;
    this.#serverId = serverId;
    this.#logger = logger.child('discovery');
  }

  /** Enderecos IPv4 nao internos, na ordem em que o app deve tentar. */
  static localAddresses() {
    const found = [];
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        found.push({ interface: name, address: entry.address });
      }
    }
    // Enderecos de tethering USB (RNDIS) costumam ficar em 192.168.42.x;
    // priorizar acelera a conexao por cabo.
    return found.sort((a, b) => {
      const score = (item) => (item.address.startsWith('192.168.42.') ? 0 : 1);
      return score(a) - score(b);
    });
  }

  get payload() {
    return {
      protocol: DiscoveryBeacon.ANNOUNCE,
      id: this.#serverId,
      name: this.#settings.serviceName,
      hostname: os.hostname(),
      httpPort: this.#httpPort,
      addresses: DiscoveryBeacon.localAddresses().map((a) => a.address),
      at: Date.now()
    };
  }

  async start() {
    if (!this.#settings.enabled || this.#socket) return this;

    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.#socket = socket;

      socket.on('message', (message, remote) => {
        if (!message.toString('utf8').startsWith(DiscoveryBeacon.PROBE)) return;
        const reply = Buffer.from(JSON.stringify(this.payload));
        socket.send(reply, remote.port, remote.address, (err) => {
          if (err) this.#logger.debug(`falha ao responder ${remote.address}: ${err.message}`);
          else this.#logger.debug(`respondeu sondagem de ${remote.address}`);
        });
      });

      socket.on('error', (err) => {
        this.#logger.warn(`socket de descoberta: ${err.message}`);
        this.#socket = null;
        resolve(this);
      });

      socket.bind(this.#settings.port, () => {
        socket.setBroadcast(true);
        this.#logger.info(`escutando sondagens na porta UDP ${this.#settings.port}`);
        this.#startAnnouncing();
        resolve(this);
      });
    });
  }

  /**
   * Anuncio periodico: cobre o caso do app entrar na rede depois do servidor,
   * sem precisar sondar ativamente.
   */
  #startAnnouncing() {
    const broadcast = () => {
      if (!this.#socket) return;
      const message = Buffer.from(JSON.stringify(this.payload));
      this.#socket.send(message, this.#settings.port, '255.255.255.255', (err) => {
        if (err) this.#logger.debug(`anuncio falhou: ${err.message}`);
      });
    };
    this.#announceTimer = setInterval(broadcast, 10000);
    this.#announceTimer.unref?.();
    broadcast();
  }

  async stop() {
    if (this.#announceTimer) {
      clearInterval(this.#announceTimer);
      this.#announceTimer = null;
    }
    if (!this.#socket) return;
    await new Promise((resolve) => this.#socket.close(resolve));
    this.#socket = null;
  }
}
