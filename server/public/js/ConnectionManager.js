/**
 * Transporte entre o aplicativo e o servidor: REST para configuracao e
 * WebSocket para tempo real.
 *
 * A reconexao usa recuo exponencial com jitter. O jitter importa quando o
 * tablet sai do modo de espera: sem ele, todos os aparelhos tentariam
 * reconectar no mesmo milissegundo.
 */
export class ConnectionManager extends EventTarget {
  static MAX_BACKOFF_MS = 8000;

  #socket = null;
  #attempts = 0;
  #reconnectTimer = null;
  #closedByUs = false;
  #status = 'idle';
  #pending = new Map();
  #nextRequestId = 1;
  #latencyMs = null;
  #latencyTimer = null;

  get status() {
    return this.#status;
  }

  get latencyMs() {
    return this.#latencyMs;
  }

  /**
   * Como o aparelho chegou ate aqui. Serve para o app mostrar "USB" ou "Wi-Fi".
   * @returns {'usb'|'wifi'|'local'}
   */
  get transport() {
    const host = location.hostname;
    // A ponte `adb reverse` faz o servidor aparecer como loopback no tablet.
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      return window.matchMedia('(pointer: coarse)').matches ? 'usb' : 'local';
    }
    return 'wifi';
  }

  // --- REST ---------------------------------------------------------------

  /**
   * @param {string} path
   * @param {{ method?: string, body?: any, raw?: ArrayBuffer|Blob, headers?: Record<string,string> }} [options]
   */
  async request(path, { method = 'GET', body, raw, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };

    if (raw) {
      init.body = raw;
      init.headers['content-type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }

    const response = await fetch(path, init);
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`resposta invalida do servidor (${response.status})`);
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error ?? `erro ${response.status}`);
      error.code = payload.code ?? null;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  // --- WebSocket ----------------------------------------------------------

  connect() {
    this.#closedByUs = false;
    this.#openSocket();
    return this;
  }

  #openSocket() {
    if (this.#socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.#socket.readyState)) return;

    this.#setStatus(this.#attempts === 0 ? 'connecting' : 'reconnecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempts = 0;
      this.#setStatus('online');
      this.#startLatencyProbe();
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      // Respostas correlacionadas resolvem a promessa de quem pediu.
      if (message.requestId && this.#pending.has(message.requestId)) {
        const entry = this.#pending.get(message.requestId);
        this.#pending.delete(message.requestId);
        clearTimeout(entry.timer);
        if (message.payload?.ok === false) {
          const error = new Error(message.payload.error ?? 'falhou');
          error.code = message.payload.code;
          entry.reject(error);
        } else {
          entry.resolve(message.payload);
        }
        return;
      }

      this.dispatchEvent(new CustomEvent('message', { detail: message }));
      this.dispatchEvent(new CustomEvent(message.type, { detail: message.payload }));
    });

    socket.addEventListener('close', () => {
      this.#stopLatencyProbe();
      this.#rejectPending(new Error('conexao perdida'));
      if (this.#closedByUs) {
        this.#setStatus('offline');
        return;
      }
      this.#setStatus('reconnecting');
      this.#scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // O evento `close` sempre vem depois; a reconexao e' tratada la'.
      socket.close();
    });
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer) return;
    this.#attempts += 1;
    const base = Math.min(ConnectionManager.MAX_BACKOFF_MS, 400 * 2 ** (this.#attempts - 1));
    const delay = base * (0.7 + Math.random() * 0.6);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, delay);
  }

  /**
   * Envia um comando e aguarda a resposta.
   * @param {string} type
   * @param {Record<string, any>} payload
   * @param {number} [timeoutMs]
   */
  send(type, payload = {}, timeoutMs = 12000) {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('sem conexao com o servidor'));
    }
    const requestId = `r${this.#nextRequestId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error('o servidor nao respondeu'));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ type, requestId, ...payload }));
    });
  }

  /**
   * Executa uma acao pelo caminho mais rapido disponivel.
   * @param {{ type: string, params?: object }} action
   * @param {{ confirm?: boolean }} [options]
   */
  async execute(action, { confirm = false } = {}) {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      const result = await this.send('action', { action, confirm });
      return result.result;
    }
    const response = await this.request('/api/actions/execute', {
      method: 'POST',
      body: { action, confirm }
    });
    return response.result;
  }

  /** Mede o tempo de ida e volta — exibido nas configuracoes. */
  #startLatencyProbe() {
    this.#stopLatencyProbe();
    const probe = async () => {
      const started = performance.now();
      try {
        await this.send('ping', {}, 5000);
        this.#latencyMs = Math.round(performance.now() - started);
        this.dispatchEvent(new CustomEvent('latency', { detail: this.#latencyMs }));
      } catch {
        this.#latencyMs = null;
      }
    };
    void probe();
    this.#latencyTimer = setInterval(probe, 10000);
  }

  #stopLatencyProbe() {
    if (this.#latencyTimer) clearInterval(this.#latencyTimer);
    this.#latencyTimer = null;
  }

  #rejectPending(error) {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }

  #setStatus(status) {
    if (this.#status === status) return;
    this.#status = status;
    this.dispatchEvent(new CustomEvent('status', { detail: status }));
  }

  close() {
    this.#closedByUs = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#stopLatencyProbe();
    this.#socket?.close();
  }
}
