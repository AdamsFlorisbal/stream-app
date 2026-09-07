import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { EventEmitter } from 'node:events';

/**
 * Erro que carrega o comando de origem, para que a camada de acoes possa
 * reportar ao cliente qual passo falhou.
 */
export class PowerShellError extends Error {
  constructor(command, message) {
    super(`${command}: ${message}`);
    this.name = 'PowerShellError';
    this.command = command;
  }
}

/**
 * Mantem um unico processo PowerShell vivo e conversa com ele por JSON-linha.
 *
 * Por que um processo persistente: `Start-Process powershell` custa ~200ms e o
 * agente ainda compila C# na inicializacao. Pagar isso por clique tornaria o
 * deck lento. Aqui o custo e' pago uma vez e cada acao vira ida-e-volta de ~2ms.
 */
export class PowerShellHost extends EventEmitter {
  #scriptPath;
  #logger;
  #child = null;
  #pending = new Map();
  #nextId = 1;
  #ready = false;
  #starting = null;
  #stopped = false;
  #restartAttempts = 0;
  #timeoutMs;

  /**
   * @param {object} deps
   * @param {import('../config/Paths.js').Paths} deps.paths
   * @param {import('../core/Logger.js').Logger} deps.logger
   * @param {number} [deps.timeoutMs]
   */
  constructor({ paths, logger, timeoutMs = 15000 }) {
    super();
    this.#scriptPath = path.join(paths.scriptsDir, 'agent.ps1');
    this.#logger = logger.child('powershell');
    this.#timeoutMs = timeoutMs;
  }

  get isReady() {
    return this.#ready;
  }

  /** Inicia o agente. Chamadas concorrentes compartilham a mesma promessa. */
  async start() {
    if (this.#ready) return this;
    if (this.#starting) return this.#starting;

    this.#starting = new Promise((resolve, reject) => {
      this.#logger.info('iniciando agente Windows');
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.#scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      this.#child = child;

      const stdout = readline.createInterface({ input: child.stdout });
      stdout.on('line', (line) => this.#handleLine(line));

      // O agente sinaliza prontidao pelo stderr; stdout e' exclusivo do protocolo.
      const stderr = readline.createInterface({ input: child.stderr });
      stderr.on('line', (line) => {
        if (line.includes('deck-agent pronto')) {
          this.#ready = true;
          this.#restartAttempts = 0;
          this.#logger.info('agente pronto');
          this.emit('ready');
          resolve(this);
        } else if (line.trim()) {
          this.#logger.warn(`agente: ${line.trim()}`);
        }
      });

      child.once('error', (err) => {
        this.#logger.error('falha ao iniciar o PowerShell', err.message);
        this.#ready = false;
        reject(err);
      });

      child.once('exit', (code) => {
        this.#ready = false;
        this.#child = null;
        this.#starting = null;
        this.#rejectAllPending(new Error(`agente encerrou (codigo ${code})`));
        this.emit('closed', code);
        if (!this.#stopped) this.#scheduleRestart();
        reject(new Error(`agente encerrou durante a inicializacao (codigo ${code})`));
      });

      // O compilador C# do PowerShell leva alguns segundos na primeira execucao.
      setTimeout(() => {
        if (!this.#ready) reject(new Error('tempo esgotado ao iniciar o agente Windows'));
      }, 30000).unref?.();
    });

    try {
      await this.#starting;
    } finally {
      this.#starting = null;
    }
    return this;
  }

  /**
   * Envia um comando e aguarda a resposta correlacionada.
   * @param {string} command
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}
   */
  async invoke(command, params = {}) {
    if (this.#stopped) throw new PowerShellError(command, 'servidor em desligamento');
    if (!this.#ready) await this.start();
    if (!this.#child?.stdin.writable) throw new PowerShellError(command, 'agente indisponivel');

    const id = this.#nextId++;
    const payload = `${JSON.stringify({ id, command, params })}\n`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new PowerShellError(command, `sem resposta em ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      timer.unref?.();

      this.#pending.set(id, { resolve, reject, command, timer });
      this.#child.stdin.write(payload, (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new PowerShellError(command, err.message));
      });
    });
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.#logger.warn('resposta ilegivel do agente', trimmed.slice(0, 200));
      return;
    }

    const entry = this.#pending.get(message.id);
    if (!entry) return;
    this.#pending.delete(message.id);
    clearTimeout(entry.timer);

    if (message.ok) entry.resolve(message.result);
    else entry.reject(new PowerShellError(entry.command, message.error ?? 'erro desconhecido'));
  }

  #rejectAllPending(error) {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }

  /** Reinicio com recuo exponencial limitado a 30s. */
  #scheduleRestart() {
    this.#restartAttempts += 1;
    const delay = Math.min(30000, 500 * 2 ** (this.#restartAttempts - 1));
    this.#logger.warn(`agente caiu; reiniciando em ${delay}ms (tentativa ${this.#restartAttempts})`);
    const timer = setTimeout(() => {
      this.start().catch((err) => this.#logger.error('reinicio falhou', err.message));
    }, delay);
    timer.unref?.();
  }

  async stop() {
    this.#stopped = true;
    this.#rejectAllPending(new Error('desligando'));
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    this.#ready = false;
    child.stdin.end();
    // Encerramento gracioso; mata se o processo insistir em ficar.
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1500);
      timer.unref?.();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
