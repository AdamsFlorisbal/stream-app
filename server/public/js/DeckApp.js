import { IconLibrary } from './IconLibrary.js';
import { ConnectionManager } from './ConnectionManager.js';
import { Toaster } from './Toaster.js';
import { TelemetryPanel } from './TelemetryPanel.js';
import { KeyGrid } from './KeyGrid.js';
import { DialStrip } from './DialStrip.js';
import { EditorSheet } from './EditorSheet.js';

/**
 * Orquestrador da interface.
 *
 * Concentra o estado do cliente e coordena os componentes visuais. Os
 * componentes nao conversam entre si: cada um emite eventos e recebe dados,
 * e e' esta classe que fecha o circuito com o servidor.
 */
export class DeckApp {
  /** Frequencia de releitura dos valores dos knobs (volume muda por fora). */
  static DIAL_REFRESH_MS = 4000;

  #dom;
  #connection = new ConnectionManager();
  #toaster;
  #telemetryPanel;
  #keyGrid;
  #dialStrip;
  #editor;

  #state = { deck: null, obs: {}, config: {}, telemetry: {}, usb: {}, server: {}, catalog: [], media: [] };
  #dialTimer = null;
  #recordStartedAt = null;
  #recordTimer = null;
  #clockTimer = null;

  #dateFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });

  constructor() {
    this.#dom = {
      shell: document.getElementById('shell'),
      hostName: document.getElementById('hostName'),
      clockTime: document.getElementById('clockTime'),
      clockDate: document.getElementById('clockDate'),
      badgeLink: document.getElementById('badgeLink'),
      badgeObs: document.getElementById('badgeObs'),
      badgeLive: document.getElementById('badgeLive'),
      badgeRec: document.getElementById('badgeRec'),
      recTimer: document.getElementById('recTimer'),
      btnEdit: document.getElementById('btnEdit'),
      btnSettings: document.getElementById('btnSettings'),
      btnFullscreen: document.getElementById('btnFullscreen'),
      telemetry: document.getElementById('telemetry'),
      pages: document.getElementById('pages'),
      grid: document.getElementById('grid'),
      strip: document.getElementById('strip'),
      toasts: document.getElementById('toasts'),
      sheet: document.getElementById('sheet'),
      sheetInner: document.getElementById('sheetInner')
    };

    this.#toaster = new Toaster(this.#dom.toasts);
    this.#telemetryPanel = new TelemetryPanel(this.#dom.telemetry);
    this.#keyGrid = new KeyGrid(this.#dom.grid);
    this.#dialStrip = new DialStrip(this.#dom.strip);
    this.#editor = new EditorSheet({
      dialog: this.#dom.sheet,
      inner: this.#dom.sheetInner,
      connection: this.#connection,
      toaster: this.#toaster
    });
  }

  async start() {
    IconLibrary.hydrate(document);
    this.#wireToolbar();
    this.#wireGrid();
    this.#wireDials();
    this.#wireEditor();
    this.#wireConnection();

    this.#connection.connect();

    // O carregamento inicial vem por REST: se o WebSocket demorar, a tela ja
    // aparece preenchida em vez de vazia.
    try {
      const snapshot = await this.#connection.request('/api/state');
      this.#applySnapshot(snapshot);
    } catch (err) {
      this.#toaster.error(`Nao consegui falar com o servidor: ${err.message}`);
    }

    this.#startDialRefresh();
    this.#startClock();
    return this;
  }

  // --- Ligacoes -----------------------------------------------------------

  #wireConnection() {
    const connection = this.#connection;

    connection.addEventListener('status', (event) => this.#renderLinkBadge(event.detail));
    connection.addEventListener('latency', () => {});

    connection.addEventListener('hello', (event) => this.#applySnapshot(event.detail));
    connection.addEventListener('telemetry', (event) => this.#telemetryPanel.update(event.detail));

    connection.addEventListener('obs', (event) => {
      this.#state.obs = event.detail;
      this.#editor.setContext({ obs: event.detail });
      this.#keyGrid.setObsState(event.detail);
      this.#renderObsBadges(event.detail);
    });

    connection.addEventListener('usb', (event) => {
      this.#state.usb = event.detail;
      this.#editor.setContext({ usb: event.detail });
    });

    const onDeckChange = (event) => {
      const deck = event.detail;
      if (deck?.profiles) this.#state.deck = deck;
      else if (deck?.pageId) this.#state.deck = { ...this.#state.deck, activePageId: deck.pageId };
      this.#editor.setContext({ deck: this.#state.deck });
      this.#renderDeck();
    };
    connection.addEventListener('deck:changed', onDeckChange);
    connection.addEventListener('deck:page', onDeckChange);
    connection.addEventListener('deck:profile', onDeckChange);

    connection.addEventListener('telemetry:unavailable', () => {});
  }

  #wireToolbar() {
    this.#dom.btnEdit.addEventListener('click', () => {
      const editing = !this.#keyGrid.editing;
      this.#keyGrid.setEditing(editing);
      this.#dom.btnEdit.setAttribute('aria-pressed', String(editing));
      this.#toaster.info(editing
        ? 'Modo edicao: toque para editar, arraste para mover'
        : 'Modo edicao desligado');
    });

    this.#dom.btnSettings.addEventListener('click', () => this.#editor.openSettings());

    this.#dom.btnFullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } catch {
        this.#toaster.info('Tela cheia indisponivel neste navegador');
      }
    });

    this.#dom.badgeObs.addEventListener('click', async () => {
      try {
        await this.#connection.request('/api/obs/reconnect', { method: 'POST', body: {} });
        this.#toaster.info('Reconectando ao OBS…');
      } catch (err) {
        this.#toaster.error(err.message);
      }
    });

    this.#dom.badgeLink.addEventListener('click', () => this.#editor.openSettings());
  }

  #wireGrid() {
    this.#keyGrid.addEventListener('press', (event) => void this.#pressKey(event.detail));

    this.#keyGrid.addEventListener('edit', (event) => {
      const { slot, button } = event.detail;
      const deck = this.#state.deck;
      if (!deck) return;
      this.#editor.openKey({
        profileId: deck.activeProfileId,
        pageId: deck.activePageId,
        slot,
        button
      });
    });

    this.#keyGrid.addEventListener('reorder', async (event) => {
      const { from, to } = event.detail;
      const deck = this.#state.deck;
      try {
        await this.#connection.request(
          `/api/profiles/${deck.activeProfileId}/pages/${deck.activePageId}/swap`,
          { method: 'POST', body: { from, to } }
        );
      } catch (err) {
        this.#toaster.error(err.message);
      }
    });
  }

  #wireDials() {
    this.#dialStrip.addEventListener('rotate', async (event) => {
      const { dial, value } = event.detail;
      try {
        const response = await this.#connection.request(`/api/dials/${dial.id}/rotate`, {
          method: 'POST',
          body: { value }
        });
        if (response.value !== null && response.value !== undefined) {
          this.#dialStrip.setValue(dial.id, response.value);
        }
      } catch (err) {
        this.#dialStrip.setValue(dial.id, null, { unavailable: true });
        this.#toaster.error(err.message);
      }
    });

    // Toque simples num knob de volume alterna o mudo.
    this.#dialStrip.addEventListener('tap', async (event) => {
      const { dial } = event.detail;
      if (!['volume.output', 'volume.input'].includes(dial.kind)) return;
      try {
        const device = dial.kind === 'volume.output' ? 'output' : 'input';
        const result = await this.#connection.execute({ type: 'volume.mute', params: { device } });
        this.#toaster.info(`${dial.label}: ${result.muted ? 'mudo' : 'com som'}`);
        // A releitura devolve nivel e mudo juntos, sem apagar o valor exibido.
        await this.#refreshDials();
      } catch (err) {
        this.#toaster.error(err.message);
      }
    });

    this.#dialStrip.addEventListener('refresh', () => void this.#refreshDials());
  }

  #wireEditor() {
    this.#editor.onSaveButton = async ({ profileId, pageId, button }) => {
      await this.#connection.request(`/api/profiles/${profileId}/pages/${pageId}/buttons`, {
        method: 'PUT',
        body: button
      });
      this.#toaster.ok('Tecla salva');
    };

    this.#editor.onDeleteButton = async (buttonId) => {
      await this.#connection.request(`/api/buttons/${buttonId}`, { method: 'DELETE' });
      this.#toaster.ok('Tecla removida');
    };

    this.#editor.onSaveSettings = async (patch) => {
      const response = await this.#connection.request('/api/config', { method: 'PATCH', body: patch });
      this.#state.config = response.config;
      this.#editor.setContext({ config: response.config });
      this.#toaster.ok('Configuracoes salvas');
    };

    this.#editor.onUploadMedia = async (file) => {
      const buffer = await file.arrayBuffer();
      const response = await this.#connection.request(
        `/api/media?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', raw: buffer, headers: { 'x-file-type': file.type || 'application/octet-stream' } }
      );
      const media = await this.#connection.request('/api/media');
      this.#state.media = media.media;
      this.#editor.setContext({ media: media.media });
      return response.media;
    };

    this.#editor.onAddPage = async ({ profileId, name, columns, rows }) => {
      await this.#connection.request(`/api/profiles/${profileId}/pages`, {
        method: 'POST',
        body: { name, columns, rows }
      });
    };

    this.#editor.onDeletePage = async (profileId, pageId) => {
      await this.#connection.request(`/api/profiles/${profileId}/pages/${pageId}`, { method: 'DELETE' });
    };
  }

  // --- Execucao -----------------------------------------------------------

  async #pressKey({ button, element }) {
    if (!button?.action?.type) return;

    // Acoes destrutivas pedem um segundo toque, para nao suspender o PC sem querer.
    const destructive = (this.#state.catalog ?? [])
      .find((entry) => entry.type === button.action.type)?.destructive;
    if (destructive && !element.dataset.confirming) {
      element.dataset.confirming = '1';
      this.#toaster.info(`Toque de novo para confirmar: ${button.label}`);
      setTimeout(() => delete element.dataset.confirming, 3200);
      return;
    }
    delete element.dataset.confirming;

    try {
      await this.#connection.execute(button.action, { confirm: Boolean(destructive) });
      this.#keyGrid.flash(element, 'ok');
      // Acoes de volume mexem nos knobs; relê para a faixa acompanhar.
      if (button.action.type.startsWith('volume.')) void this.#refreshDials();
    } catch (err) {
      this.#keyGrid.flash(element, 'error');
      this.#toaster.error(err.message);
      if (navigator.vibrate) navigator.vibrate([25, 40, 25]);
    }
  }

  // --- Renderizacao -------------------------------------------------------

  #applySnapshot(snapshot) {
    if (!snapshot) return;

    this.#state = {
      ...this.#state,
      deck: snapshot.deck ?? this.#state.deck,
      obs: snapshot.obs ?? this.#state.obs,
      config: snapshot.config ?? this.#state.config,
      telemetry: snapshot.telemetry ?? this.#state.telemetry,
      usb: snapshot.usb ?? this.#state.usb,
      server: snapshot.server ?? this.#state.server,
      catalog: snapshot.catalog ?? this.#state.catalog,
      media: snapshot.media ?? this.#state.media
    };

    this.#editor.setContext({
      catalog: this.#state.catalog,
      obs: this.#state.obs,
      media: this.#state.media,
      deck: this.#state.deck,
      config: this.#state.config,
      telemetry: this.#state.telemetry,
      usb: this.#state.usb,
      server: this.#state.server
    });

    const transport = this.#connection.transport;
    this.#dom.hostName.textContent = `${this.#state.server.hostname ?? 'PC'} · `
      + (transport === 'usb' ? 'cabo USB' : transport === 'wifi' ? 'Wi-Fi' : 'local');

    this.#renderDeck();
    this.#keyGrid.setObsState(this.#state.obs);
    this.#renderObsBadges(this.#state.obs);
    if (this.#state.telemetry?.latest) this.#telemetryPanel.update(this.#state.telemetry.latest);
    void this.#refreshDials();
  }

  #renderDeck() {
    const deck = this.#state.deck;
    if (!deck) return;

    const profile = deck.profiles.find((p) => p.id === deck.activeProfileId) ?? deck.profiles[0];
    const page = profile?.pages.find((p) => p.id === deck.activePageId) ?? profile?.pages[0];
    if (!page) return;

    this.#renderPageTabs(profile, page);
    this.#keyGrid.render(page);
    this.#keyGrid.setObsState(this.#state.obs);
    this.#dialStrip.render(page);
    void this.#refreshDials();
  }

  #renderPageTabs(profile, activePage) {
    this.#dom.pages.replaceChildren();

    for (const page of profile.pages) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'page-tab' + (page.id === activePage.id ? ' is-active' : '');
      tab.textContent = page.name;
      tab.addEventListener('click', async () => {
        if (page.id === activePage.id) return;
        try {
          await this.#connection.request('/api/profiles/active', {
            method: 'PUT',
            body: { pageId: page.id }
          });
        } catch (err) {
          this.#toaster.error(err.message);
        }
      });
      this.#dom.pages.append(tab);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'page-tab page-tab--add';
    add.title = 'Gerenciar paginas';
    add.append(IconLibrary.create('plus'));
    add.addEventListener('click', () => this.#editor.openSettings());
    this.#dom.pages.append(add);
  }

  #renderLinkBadge(status) {
    const badge = this.#dom.badgeLink;
    const text = badge.querySelector('.badge__text');
    const transport = this.#connection.transport;
    const label = transport === 'usb' ? 'USB' : transport === 'wifi' ? 'Wi-Fi' : 'Local';

    badge.classList.remove('is-on', 'is-off', 'is-warn');
    if (status === 'online') {
      badge.classList.add('is-on');
      text.textContent = label;
    } else if (status === 'reconnecting' || status === 'connecting') {
      badge.classList.add('is-warn');
      text.textContent = 'Reconectando';
    } else {
      badge.classList.add('is-off');
      text.textContent = 'Offline';
    }
  }

  #renderObsBadges(obs = {}) {
    const badge = this.#dom.badgeObs;
    badge.classList.remove('is-on', 'is-off', 'is-warn');
    badge.classList.add(obs.connected ? 'is-on' : 'is-off');
    badge.querySelector('.badge__text').textContent = obs.connected ? 'OBS' : 'OBS off';
    badge.title = obs.connected ? `OBS ${obs.obsVersion ?? ''}` : (obs.lastError ?? 'desconectado');

    this.#dom.badgeLive.hidden = !obs.streaming;
    this.#dom.badgeRec.hidden = !obs.recording;

    if (obs.recording && !this.#recordTimer) this.#startRecordTimer();
    if (!obs.recording && this.#recordTimer) this.#stopRecordTimer();
  }

  #startRecordTimer() {
    this.#recordStartedAt = Date.now();
    const tick = () => {
      const seconds = Math.floor((Date.now() - this.#recordStartedAt) / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      this.#dom.recTimer.textContent = `${mm}:${ss}`;
    };
    tick();
    this.#recordTimer = setInterval(tick, 1000);
  }

  #stopRecordTimer() {
    clearInterval(this.#recordTimer);
    this.#recordTimer = null;
    this.#dom.recTimer.textContent = '00:00';
  }

  #startClock() {
    const tick = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      this.#dom.clockTime.textContent = `${hh}:${mm}:${ss}`;
      const date = this.#dateFormatter.format(now).replace(/\./g, '');
      this.#dom.clockDate.textContent = date.charAt(0).toUpperCase() + date.slice(1);
    };
    tick();
    this.#clockTimer = setInterval(tick, 1000);
  }

  // --- Knobs --------------------------------------------------------------

  #startDialRefresh() {
    this.#dialTimer = setInterval(() => {
      if (document.hidden) return;
      void this.#refreshDials();
    }, DeckApp.DIAL_REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.#refreshDials();
    });
  }

  /**
   * Le o valor de todos os knobs da pagina em uma unica requisicao e aplica na
   * faixa. Chamado ao trocar de pagina, ao voltar do segundo plano e em
   * intervalo fixo — o volume do Windows pode mudar por fora do aplicativo.
   */
  async #refreshDials() {
    if (this.#dialStrip.dials.length === 0) return;
    try {
      const response = await this.#connection.request('/api/dials');
      for (const entry of response.dials ?? []) {
        this.#dialStrip.setValue(entry.dialId, entry.value, {
          muted: entry.muted ?? null,
          unavailable: entry.available === false
        });
      }
    } catch {
      // Sem conexao a faixa mantem o ultimo valor; a proxima rodada corrige.
    }
  }
}
