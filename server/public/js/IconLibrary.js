/**
 * Conjunto de icones vetoriais desenhados em linha (24x24, `currentColor`).
 *
 * Embutir os caminhos em vez de carregar uma biblioteca de icones mantem o app
 * funcionando sem internet e sem nenhuma requisicao extra — importante porque
 * o servidor roda na rede local e o tablet pode estar offline.
 */
export class IconLibrary {
  /** @type {Record<string, string>} nome -> conteudo interno do <svg> */
  static PATHS = {
    deck: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M8.5 8h.01M12 8h.01M15.5 8h.01M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
    obs: '<circle cx="12" cy="12" r="9"/><circle cx="9.5" cy="12" r="3.6"/>',
    twitch: '<path d="M4 3h16v11l-4 4h-3l-3 3H8v-3H4z"/><path d="M11 8v4M15 8v4"/>',
    clapper: '<path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9l1.6-4.2 16.2 1.3L21 9M8.4 8.7L10 4.6M13.4 9.1L15 5"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    'mic-off': '<path d="M15 5a3 3 0 0 0-6 0v4m0 3a3 3 0 0 0 5.1 2.1"/><path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11v.6M12 17.5V21M8.5 21h7M3 3l18 18"/>',
    record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
    one: '<path d="M9.5 8.5L12 6.5V18M9 18h6"/>',
    two: '<path d="M8.5 8.5a3.5 3.5 0 1 1 6 2.4L8.5 18H15"/>',
    three: '<path d="M8.5 7.5a3.4 3.4 0 1 1 2.6 5.6 3.4 3.4 0 1 1-2.6 5.4"/>',
    four: '<path d="M14.5 18V6l-6 8.5h8.5"/>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01"/>',
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h6.6l1.2 2h1.8A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
    desktop: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4M7 9.5h4"/>',
    pages: '<rect x="3" y="6.5" width="12" height="12" rx="2"/><path d="M8 6.5V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1.5"/>',
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    pause: '<path d="M9 4.5v15M15 4.5v15"/>',
    prev: '<path d="M18 5.5v13L8.5 12zM6 5.5v13"/>',
    next: '<path d="M6 5.5v13L15.5 12zM18 5.5v13"/>',
    rewind: '<path d="M12 5.5v13L3 12zM22 5.5v13L13 12z"/>',
    speaker: '<path d="M11 5L6.5 9H3v6h3.5L11 19z"/><path d="M15 9.2a4 4 0 0 1 0 5.6M18 6.5a8 8 0 0 1 0 11"/>',
    'speaker-off': '<path d="M11 5L6.5 9H3v6h3.5L11 19z"/><path d="M16 10l5 4M21 10l-5 4"/>',
    headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="14" width="4.5" height="6.5" rx="2"/><rect x="17" y="14" width="4.5" height="6.5" rx="2"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3.5"/>',
    paste: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3.5v1M9 11h6M9 15h4"/>',
    windows: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M18 13h.01M9.5 14.5h5"/>',
    type: '<path d="M4 6.5V4.5h16v2M12 4.5V19M9 19h6"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
    layers: '<path d="M12 3l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.5l9 4.8 9-4.8M3 17l9 4.8 9-4.8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
    power: '<path d="M12 3v9"/><path d="M6.8 6.4a8.5 8.5 0 1 0 10.4 0"/>',
    save: '<path d="M4.5 5.5a2 2 0 0 1 2-2h9L20.5 8v10.5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z"/><path d="M8 3.5v5h7M8 14h8v6.5H8z"/>',
    transition: '<path d="M3 8h11M10.5 4.5L14 8l-3.5 3.5M21 16H10M13.5 12.5L10 16l3.5 3.5"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3.5 6.5h17M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 6.5l1 13a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9l1-13"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    x: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
    alert: '<path d="M12 3.5L22 20H2z"/><path d="M12 9.5v4M12 16.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0M12 20h.01"/>',
    usb: '<circle cx="12" cy="20" r="1.6"/><path d="M12 18.4V4M12 4l-2.4 3h4.8z" /><path d="M12 13l4-3V7.5M16 6.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM12 15.5l-4-3v-2M8 9a1.3 1.3 0 1 0 0 2.6"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3.5M15 3v3.5M9 17.5V21M15 17.5V21M3 9h3.5M3 15h3.5M17.5 9H21M17.5 15H21"/>',
    gpu: '<rect x="2.5" y="7" width="19" height="10" rx="2"/><circle cx="8" cy="12" r="2.6"/><circle cx="15.5" cy="12" r="2"/><path d="M5 20v-3M19 20v-3"/>',
    ram: '<rect x="2.5" y="7.5" width="19" height="9" rx="1.5"/><path d="M6 16.5v3M10 16.5v3M14 16.5v3M18 16.5v3M7 11h2.5M11.5 11H14M16 11h1.5"/>',
    network: '<path d="M12 3v5M12 16v5M4.5 12H2M22 12h-2.5"/><circle cx="12" cy="12" r="4"/><path d="M6.3 6.3l2.8 2.8M17.7 17.7l-2.8-2.8M17.7 6.3l-2.8 2.8M6.3 17.7l2.8-2.8"/>',
    disk: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M14 14l4.5 4.5"/>',
    thermometer: '<path d="M13.5 14.2V4.5a2 2 0 1 0-4 0v9.7a4.2 4.2 0 1 0 4 0z"/><path d="M11.5 8v6.6"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    gamepad: '<rect x="2.5" y="7" width="19" height="10.5" rx="4"/><path d="M7 10.5v3M5.5 12h3M15.5 11h.01M18 13.5h.01"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.9A8 8 0 1 1 21 12z"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.8"/><path d="M3 16l4.5-4 4 3.5L15.5 11l5.5 5"/>',
    link: '<path d="M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7"/><path d="M14 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"/>',
    star: '<path d="M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.4L12 17.1 6.4 20.3l1.3-6.4L3 9.6l6.3-.7z"/>',
    heart: '<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5z"/>',
    bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
    shield: '<path d="M12 2.5l8 3v6c0 5-3.4 9-8 10.5C7.4 20.5 4 16.5 4 11.5v-6z"/><path d="M9 12l2 2 4-4"/>',
    drag: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>'
  };

  /** Ordem exibida no seletor de icones do editor. */
  static PICKER_ORDER = [
    'obs', 'twitch', 'clapper', 'person', 'camera', 'record', 'mic', 'mic-off',
    'headphones', 'speaker', 'speaker-off', 'play', 'pause', 'prev', 'next', 'rewind',
    'one', 'two', 'three', 'four', 'pages', 'layers', 'transition', 'sparkles',
    'browser', 'windows', 'desktop', 'monitor', 'folder', 'terminal', 'keyboard', 'type',
    'copy', 'paste', 'search', 'eye', 'link', 'image', 'lock', 'power',
    'sun', 'clock', 'refresh', 'save', 'settings', 'zap', 'gamepad', 'chat',
    'star', 'heart', 'bell', 'shield', 'cpu', 'gpu', 'ram', 'network'
  ];

  /**
   * Cria um elemento SVG para o icone informado.
   * @param {string} name
   * @param {{ size?: number, fill?: boolean }} [options]
   * @returns {SVGSVGElement}
   */
  static create(name, { size = null, fill = false } = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', fill ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (size) {
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
    }
    svg.innerHTML = IconLibrary.PATHS[name] ?? IconLibrary.PATHS.deck;
    return svg;
  }

  static has(name) {
    return Object.hasOwn(IconLibrary.PATHS, name);
  }

  /** Substitui todos os `[data-icon]` de um container pelos SVGs. */
  static hydrate(root = document) {
    for (const holder of root.querySelectorAll('[data-icon]')) {
      const name = holder.dataset.icon;
      holder.replaceChildren(IconLibrary.create(name));
    }
  }
}
