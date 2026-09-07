import { randomUUID } from 'node:crypto';
import { JsonStore } from './JsonStore.js';

/**
 * Raiz de agregacao do deck: perfis -> paginas -> teclas/knobs.
 * Toda escrita passa por aqui para que validacao e normalizacao de slots fiquem
 * em um unico lugar, e nao espalhadas pelos controladores HTTP.
 * @extends {JsonStore<any>}
 */
export class ProfileStore extends JsonStore {
  /** @param {{ paths: import('./Paths.js').Paths, logger: import('../core/Logger.js').Logger }} deps */
  constructor({ paths, logger }) {
    super({ file: paths.profilesFile, defaults: ProfileStore.defaults(), logger: logger.child('profiles') });
  }

  /** Atalho de fabrica para manter o bloco de padroes legivel. */
  static key(slot, label, glyph, accent, action, extra = {}) {
    return { id: randomUUID(), slot, label, glyph, accent, action, ...extra };
  }

  static dial(slot, label, glyph, accent, kind, params = null) {
    return { id: randomUUID(), slot, label, glyph, accent, kind, params };
  }

  static defaults() {
    const streamPage = {
      id: 'home',
      name: 'Transmissao',
      columns: 4,
      rows: 3,
      buttons: [
        ProfileStore.key(0, 'Live', 'obs', '#f8fafc', { type: 'obs.stream.toggle' }, { stateBinding: 'obs.streaming' }),
        ProfileStore.key(1, 'Twitch', 'twitch', '#a970ff', { type: 'url', params: { value: 'https://twitch.tv' } }),
        ProfileStore.key(2, 'Cena Live', 'clapper', '#22d3ee', { type: 'obs.scene', params: { sceneName: 'Live' } }, { stateBinding: 'obs.scene:Live' }),
        ProfileStore.key(3, 'Camera', 'person', '#f472b6', { type: 'obs.scene', params: { sceneName: 'Camera' } }, { stateBinding: 'obs.scene:Camera' }),
        ProfileStore.key(4, 'Mic OBS', 'mic', '#fbbf24', { type: 'obs.input.mute', params: { inputName: 'Mic/Aux', mode: 'toggle' } }, { stateBinding: 'obs.mute:Mic/Aux' }),
        ProfileStore.key(5, 'Gravar', 'record', '#ef4444', { type: 'obs.record.toggle' }, { stateBinding: 'obs.recording' }),
        ProfileStore.key(6, 'Cena 1', 'one', '#22d3ee', { type: 'obs.scene', params: { sceneName: 'Cena 1' } }, { stateBinding: 'obs.scene:Cena 1' }),
        ProfileStore.key(7, 'Cena 2', 'two', '#f472b6', { type: 'obs.scene', params: { sceneName: 'Cena 2' } }, { stateBinding: 'obs.scene:Cena 2' }),
        ProfileStore.key(8, 'Navegador', 'browser', '#60a5fa', { type: 'window.activate', params: { match: 'chrome' } }),
        ProfileStore.key(9, 'Print', 'camera', '#a78bfa', { type: 'hotkey', params: { keys: 'win+shift+s' } }),
        ProfileStore.key(10, 'Desktop', 'desktop', '#34d399', { type: 'desktop.switch', params: { direction: 'next' } }),
        ProfileStore.key(11, 'Pagina 2', 'pages', '#94a3b8', { type: 'deck.page', params: { target: 'next' } })
      ],
      dials: [
        ProfileStore.dial(0, 'Master', 'speaker', '#22d3ee', 'volume.output'),
        ProfileStore.dial(1, 'Microfone', 'mic', '#f472b6', 'volume.input'),
        ProfileStore.dial(2, 'Brilho', 'sun', '#fbbf24', 'display.brightness'),
        ProfileStore.dial(3, 'Mic OBS', 'headphones', '#a78bfa', 'obs.input.volume', { inputName: 'Mic/Aux' })
      ]
    };

    const systemPage = {
      id: 'system',
      name: 'Sistema',
      columns: 4,
      rows: 3,
      buttons: [
        ProfileStore.key(0, 'Play', 'play', '#22d3ee', { type: 'media', params: { key: 'playpause' } }),
        ProfileStore.key(1, 'Anterior', 'prev', '#94a3b8', { type: 'media', params: { key: 'prev' } }),
        ProfileStore.key(2, 'Proxima', 'next', '#94a3b8', { type: 'media', params: { key: 'next' } }),
        ProfileStore.key(3, 'Mudo', 'speaker-off', '#ef4444', { type: 'volume.mute', params: { device: 'output' } }),
        ProfileStore.key(4, 'Arquivos', 'folder', '#fbbf24', { type: 'launch', params: { target: 'explorer.exe' } }),
        ProfileStore.key(5, 'Terminal', 'terminal', '#34d399', { type: 'launch', params: { target: 'wt.exe' } }),
        ProfileStore.key(6, 'Copiar', 'copy', '#60a5fa', { type: 'hotkey', params: { keys: 'ctrl+c' } }),
        ProfileStore.key(7, 'Colar', 'paste', '#60a5fa', { type: 'hotkey', params: { keys: 'ctrl+v' } }),
        ProfileStore.key(8, 'Alt+Tab', 'windows', '#a78bfa', { type: 'hotkey', params: { keys: 'alt+tab' } }),
        ProfileStore.key(9, 'Bloquear', 'lock', '#f472b6', { type: 'system.lock' }),
        ProfileStore.key(10, 'Desktop', 'desktop', '#34d399', { type: 'desktop.switch', params: { direction: 'prev' } }),
        ProfileStore.key(11, 'Pagina 1', 'pages', '#94a3b8', { type: 'deck.page', params: { target: 'prev' } })
      ],
      dials: [
        ProfileStore.dial(0, 'Master', 'speaker', '#22d3ee', 'volume.output'),
        ProfileStore.dial(1, 'Microfone', 'mic', '#f472b6', 'volume.input'),
        ProfileStore.dial(2, 'Brilho', 'sun', '#fbbf24', 'display.brightness'),
        ProfileStore.dial(3, 'Zoom', 'search', '#94a3b8', 'hotkey.pair', { up: 'ctrl+plus', down: 'ctrl+minus' })
      ]
    };

    return {
      version: 1,
      activeProfileId: 'main',
      activePageId: 'home',
      profiles: [{ id: 'main', name: 'Principal', pages: [streamPage, systemPage] }]
    };
  }

  migrate(raw) {
    if (!raw || !Array.isArray(raw.profiles) || raw.profiles.length === 0) return ProfileStore.defaults();
    for (const profile of raw.profiles) {
      profile.id ??= randomUUID();
      profile.pages ??= [];
      for (const page of profile.pages) {
        page.id ??= randomUUID();
        page.columns ||= 4;
        page.rows ||= 3;
        page.buttons ??= [];
        page.dials ??= [];
        for (const button of page.buttons) button.id ??= randomUUID();
        for (const dial of page.dials) dial.id ??= randomUUID();
      }
    }
    return raw;
  }

  get profiles() {
    return this.data.profiles;
  }

  get activeProfile() {
    return this.profiles.find((p) => p.id === this.data.activeProfileId) ?? this.profiles[0];
  }

  get activePage() {
    const profile = this.activeProfile;
    return profile.pages.find((p) => p.id === this.data.activePageId) ?? profile.pages[0];
  }

  getProfile(id) {
    return this.profiles.find((p) => p.id === id) ?? null;
  }

  getPage(profileId, pageId) {
    return this.getProfile(profileId)?.pages.find((p) => p.id === pageId) ?? null;
  }

  /**
   * Localiza uma tecla em qualquer perfil/pagina.
   * @returns {{ profile: any, page: any, button: any } | null}
   */
  findButton(buttonId) {
    for (const profile of this.profiles) {
      for (const page of profile.pages) {
        const button = page.buttons.find((b) => b.id === buttonId);
        if (button) return { profile, page, button };
      }
    }
    return null;
  }

  findDial(dialId) {
    for (const profile of this.profiles) {
      for (const page of profile.pages) {
        const dial = page.dials.find((d) => d.id === dialId);
        if (dial) return { profile, page, dial };
      }
    }
    return null;
  }

  /** Cria ou atualiza uma tecla, garantindo um unico ocupante por slot. */
  upsertButton(profileId, pageId, patch) {
    const page = this.getPage(profileId, pageId);
    if (!page) throw new Error(`pagina ${profileId}/${pageId} nao encontrada`);
    const capacity = page.columns * page.rows;
    if (!Number.isInteger(patch.slot) || patch.slot < 0 || patch.slot >= capacity) {
      throw new Error(`slot ${patch.slot} fora da grade (0..${capacity - 1})`);
    }
    let stored;
    this.update(() => {
      const existing = patch.id ? page.buttons.find((b) => b.id === patch.id) : null;
      if (existing) {
        Object.assign(existing, patch);
        stored = existing;
      } else {
        const index = page.buttons.findIndex((b) => b.slot === patch.slot);
        if (index >= 0) page.buttons.splice(index, 1);
        stored = { ...patch, id: patch.id ?? randomUUID() };
        page.buttons.push(stored);
      }
    });
    return stored;
  }

  removeButton(buttonId) {
    const found = this.findButton(buttonId);
    if (!found) return false;
    this.update(() => {
      found.page.buttons = found.page.buttons.filter((b) => b.id !== buttonId);
    });
    return true;
  }

  /** Troca duas teclas de posicao — usado pelo arrastar-e-soltar da interface. */
  swapSlots(profileId, pageId, fromSlot, toSlot) {
    const page = this.getPage(profileId, pageId);
    if (!page) throw new Error('pagina nao encontrada');
    this.update(() => {
      const origin = page.buttons.find((b) => b.slot === fromSlot);
      const target = page.buttons.find((b) => b.slot === toSlot);
      if (origin) origin.slot = toSlot;
      if (target) target.slot = fromSlot;
    });
    return page;
  }

  upsertDial(profileId, pageId, patch) {
    const page = this.getPage(profileId, pageId);
    if (!page) throw new Error('pagina nao encontrada');
    let stored;
    this.update(() => {
      const existing = patch.id ? page.dials.find((d) => d.id === patch.id) : null;
      if (existing) {
        Object.assign(existing, patch);
        stored = existing;
      } else {
        stored = { ...patch, id: patch.id ?? randomUUID() };
        page.dials = page.dials.filter((d) => d.slot !== patch.slot).concat(stored);
      }
    });
    return stored;
  }

  /** Define a pagina ativa aceitando `next`, `prev` ou um id concreto. */
  setActivePage(target) {
    const pages = this.activeProfile.pages;
    const currentIndex = Math.max(0, pages.findIndex((p) => p.id === this.data.activePageId));
    let next;
    if (target === 'next') next = pages[(currentIndex + 1) % pages.length];
    else if (target === 'prev') next = pages[(currentIndex - 1 + pages.length) % pages.length];
    else next = pages.find((p) => p.id === target);
    if (!next) throw new Error(`pagina "${target}" nao encontrada`);
    this.update((data) => { data.activePageId = next.id; });
    return next;
  }

  setActiveProfile(profileId) {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error(`perfil "${profileId}" nao encontrado`);
    this.update((data) => {
      data.activeProfileId = profile.id;
      data.activePageId = profile.pages[0]?.id ?? null;
    });
    return profile;
  }

  addPage(profileId, { name, columns = 4, rows = 3 }) {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error('perfil nao encontrado');
    const page = { id: randomUUID(), name, columns, rows, buttons: [], dials: [] };
    this.update(() => { profile.pages.push(page); });
    return page;
  }

  removePage(profileId, pageId) {
    const profile = this.getProfile(profileId);
    if (!profile || profile.pages.length <= 1) return false;
    this.update((data) => {
      profile.pages = profile.pages.filter((p) => p.id !== pageId);
      if (data.activePageId === pageId) data.activePageId = profile.pages[0].id;
    });
    return true;
  }

  /** Estado completo que a interface consome em uma unica leitura. */
  toClientJSON() {
    return {
      activeProfileId: this.activeProfile?.id ?? null,
      activePageId: this.activePage?.id ?? null,
      profiles: this.profiles
    };
  }
}
