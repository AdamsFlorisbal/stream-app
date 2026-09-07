import { IconLibrary } from './IconLibrary.js';

/**
 * Painel deslizante de edicao: configura uma tecla ou abre as configuracoes.
 *
 * Os campos de cada acao nao sao codificados aqui — vem do catalogo publicado
 * pelo servidor (`describe()` de cada handler). Assim, criar uma acao nova no
 * backend a torna editavel no aplicativo sem alterar nenhuma linha de
 * interface.
 */
export class EditorSheet {
  /** Paleta de destaque das teclas. */
  static PALETTE = [
    '#22d3ee', '#38bdf8', '#60a5fa', '#a78bfa', '#c084fc',
    '#f472b6', '#fb7185', '#ef4444', '#fb923c', '#fbbf24',
    '#a3e635', '#34d399', '#2dd4bf', '#94a3b8', '#f8fafc'
  ];

  /** Ligacoes de estado que fazem a tecla acender sozinha. */
  static BINDINGS = [
    { value: '', label: 'Nenhuma (tecla sempre apagada)' },
    { value: 'obs.streaming', label: 'OBS · transmitindo' },
    { value: 'obs.recording', label: 'OBS · gravando' },
    { value: 'obs.recordPaused', label: 'OBS · gravacao pausada' },
    { value: 'obs.virtualcam', label: 'OBS · camera virtual' },
    { value: 'obs.replay', label: 'OBS · replay buffer' },
    { value: 'obs.studio', label: 'OBS · modo estudio' },
    { value: 'obs.scene:', label: 'OBS · cena ativa e' },
    { value: 'obs.mute:', label: 'OBS · entrada mutada' }
  ];

  #dialog;
  #inner;
  #connection;
  #toaster;
  #context = { catalog: [], obs: {}, media: [], deck: {}, config: {}, telemetry: {}, usb: {}, server: {} };
  #windowsCache = null;

  /** Retornos de chamada preenchidos pelo {@link DeckApp}. */
  onSaveButton = async () => {};
  onDeleteButton = async () => {};
  onSaveSettings = async () => {};
  onUploadMedia = async () => {};
  onDeleteMedia = async () => {};
  onAddPage = async () => {};
  onDeletePage = async () => {};

  constructor({ dialog, inner, connection, toaster }) {
    this.#dialog = dialog;
    this.#inner = inner;
    this.#connection = connection;
    this.#toaster = toaster;

    // Toque fora do painel fecha, como uma folha deslizante nativa.
    this.#dialog.addEventListener('click', (event) => {
      if (event.target === this.#dialog) this.close();
    });
  }

  setContext(partial) {
    Object.assign(this.#context, partial);
  }

  close() {
    if (this.#dialog.open) this.#dialog.close();
  }

  #open(node) {
    this.#inner.replaceChildren(node);
    if (!this.#dialog.open) this.#dialog.showModal();
    this.#inner.scrollTop = 0;
  }

  // =========================================================================
  //  Editor de tecla
  // =========================================================================

  /**
   * @param {{ profileId: string, pageId: string, slot: number, button: object|null }} target
   */
  openKey({ profileId, pageId, slot, button }) {
    const draft = structuredClone(button ?? {
      slot,
      label: '',
      glyph: 'deck',
      accent: '#22d3ee',
      action: { type: '', params: {} },
      stateBinding: ''
    });
    draft.slot = slot;
    draft.action ??= { type: '', params: {} };
    draft.action.params ??= {};

    const form = document.createElement('form');
    form.addEventListener('submit', (event) => event.preventDefault());

    form.append(
      this.#title(button ? 'edit' : 'plus', button ? 'Editar tecla' : 'Nova tecla',
        `Posicao ${slot + 1} · segure uma tecla a qualquer momento para voltar aqui.`),
      this.#textField('Nome', draft.label, (value) => { draft.label = value; }, 'Ex.: Cena Live'),
      this.#iconField(draft),
      this.#colorField(draft),
      this.#actionField(draft),
      this.#bindingField(draft)
    );

    const buttons = document.createElement('div');
    buttons.className = 'buttons';

    if (button) {
      const remove = this.#button('Excluir', 'btn btn--danger btn--ghost', async () => {
        await this.onDeleteButton(button.id);
        this.close();
      });
      buttons.append(remove);
    }

    buttons.append(
      this.#button('Cancelar', 'btn', () => this.close()),
      this.#button('Salvar', 'btn btn--primary', async () => {
        if (!draft.action.type) {
          this.#toaster.error('Escolha o que a tecla vai fazer');
          return;
        }
        if (!draft.label) draft.label = this.#labelFor(draft.action.type);
        await this.onSaveButton({ profileId, pageId, button: draft });
        this.close();
      })
    );

    form.append(buttons);
    this.#open(form);
  }

  #iconField(draft) {
    const field = document.createElement('div');
    field.className = 'field';
    field.append(Object.assign(document.createElement('label'), { textContent: 'Icone' }));

    const picker = document.createElement('div');
    picker.className = 'icon-picker';

    const select = (element, apply) => {
      for (const option of picker.querySelectorAll('.icon-option')) option.classList.remove('is-selected');
      element.classList.add('is-selected');
      apply();
    };

    // Botao de envio: e' aqui que entram os GIFs animados.
    const upload = document.createElement('label');
    upload.className = 'icon-option';
    upload.title = 'Enviar GIF, PNG ou video';
    upload.append(IconLibrary.create('image'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/gif,image/png,image/webp,image/avif,image/jpeg,image/svg+xml,video/mp4,video/webm';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const media = await this.onUploadMedia(file);
        draft.media = media.url;
        delete draft.glyph;
        this.#toaster.ok(`${media.name} enviado`);
        // Redesenha o seletor para o arquivo novo aparecer ja selecionado.
        field.replaceWith(this.#iconField(draft));
      } catch (err) {
        this.#toaster.error(err.message);
      } finally {
        input.value = '';
      }
    });
    upload.append(input);
    picker.append(upload);

    for (const media of this.#context.media ?? []) {
      const option = document.createElement('div');
      option.className = 'icon-option';
      if (draft.media === media.url) option.classList.add('is-selected');
      option.title = media.name;
      const preview = document.createElement(/\.(mp4|webm)$/i.test(media.url) ? 'video' : 'img');
      preview.src = media.url;
      if (preview.tagName === 'VIDEO') { preview.muted = true; preview.loop = true; preview.autoplay = true; preview.playsInline = true; }
      option.append(preview);
      option.addEventListener('click', () => select(option, () => {
        draft.media = media.url;
        delete draft.glyph;
      }));
      picker.append(option);
    }

    for (const name of IconLibrary.PICKER_ORDER) {
      const option = document.createElement('div');
      option.className = 'icon-option';
      if (!draft.media && draft.glyph === name) option.classList.add('is-selected');
      option.title = name;
      option.append(IconLibrary.create(name));
      option.addEventListener('click', () => select(option, () => {
        draft.glyph = name;
        delete draft.media;
      }));
      picker.append(option);
    }

    field.append(picker);
    if (draft.media) {
      const note = document.createElement('p');
      note.className = 'field__note';
      note.textContent = 'Usando midia enviada. Escolha um icone vetorial para voltar ao padrao.';
      field.append(note);
    }
    return field;
  }

  #colorField(draft) {
    const field = document.createElement('div');
    field.className = 'field';
    field.append(Object.assign(document.createElement('label'), { textContent: 'Cor de destaque' }));

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const color of EditorSheet.PALETTE) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.style.background = color;
      swatch.style.color = color;
      if (draft.accent === color) swatch.classList.add('is-selected');
      swatch.addEventListener('click', () => {
        for (const other of swatches.children) other.classList.remove('is-selected');
        swatch.classList.add('is-selected');
        draft.accent = color;
      });
      swatches.append(swatch);
    }
    field.append(swatches);
    return field;
  }

  #actionField(draft) {
    const wrapper = document.createElement('div');

    const field = document.createElement('div');
    field.className = 'field';
    field.append(Object.assign(document.createElement('label'), { textContent: 'O que esta tecla faz' }));

    const select = document.createElement('select');
    select.className = 'select';
    select.append(new Option('Escolha uma acao…', ''));

    const groups = new Map();
    for (const entry of this.#context.catalog ?? []) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }
    for (const [group, entries] of groups) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group;
      for (const entry of entries) {
        const option = new Option(entry.label + (entry.destructive ? ' ⚠' : ''), entry.type);
        option.selected = entry.type === draft.action.type;
        optgroup.append(option);
      }
      select.append(optgroup);
    }

    const params = document.createElement('div');

    const renderParams = () => {
      const definition = (this.#context.catalog ?? []).find((entry) => entry.type === draft.action.type);
      params.replaceChildren();
      if (!definition) return;

      if (definition.note) {
        const callout = document.createElement('div');
        callout.className = 'callout callout--info';
        callout.textContent = definition.note;
        params.append(callout, document.createElement('div')).style?.setProperty?.('height', '10px');
      }
      for (const spec of definition.fields ?? []) {
        params.append(this.#renderFieldSpec(spec, draft.action.params));
      }
      // Preenche a ligacao de estado automaticamente para acoes obvias.
      this.#suggestBinding(draft);
    };

    select.addEventListener('change', () => {
      draft.action = { type: select.value, params: {} };
      const definition = (this.#context.catalog ?? []).find((entry) => entry.type === select.value);
      for (const spec of definition?.fields ?? []) {
        if (spec.default !== undefined) draft.action.params[spec.key] = spec.default;
      }
      renderParams();
      wrapper.dispatchEvent(new CustomEvent('binding-changed', { bubbles: true }));
    });

    field.append(select);
    wrapper.append(field, params);
    renderParams();
    return wrapper;
  }

  /**
   * Desenha um campo a partir da descricao vinda do servidor.
   * @param {object} spec
   * @param {Record<string, any>} target
   */
  #renderFieldSpec(spec, target) {
    const field = document.createElement('div');
    field.className = 'field';
    field.append(Object.assign(document.createElement('label'), { textContent: spec.label }));

    const current = target[spec.key] ?? spec.default ?? '';

    switch (spec.type) {
      case 'select': {
        const select = document.createElement('select');
        select.className = 'select';
        for (const option of spec.options ?? []) {
          const element = new Option(option.label, JSON.stringify(option.value));
          element.selected = JSON.stringify(current) === JSON.stringify(option.value);
          select.append(element);
        }
        select.addEventListener('change', () => { target[spec.key] = JSON.parse(select.value); });
        if (target[spec.key] === undefined && spec.options?.length) {
          target[spec.key] = JSON.parse(select.value);
        }
        field.append(select);
        break;
      }

      case 'boolean': {
        const select = document.createElement('select');
        select.className = 'select';
        select.append(new Option('Nao', 'false'), new Option('Sim', 'true'));
        select.value = String(Boolean(current));
        select.addEventListener('change', () => { target[spec.key] = select.value === 'true'; });
        field.append(select);
        break;
      }

      case 'number': {
        const input = document.createElement('input');
        input.className = 'input';
        input.type = 'number';
        if (spec.min !== undefined) input.min = String(spec.min);
        if (spec.max !== undefined) input.max = String(spec.max);
        input.value = String(current ?? '');
        input.addEventListener('input', () => { target[spec.key] = Number(input.value); });
        field.append(input);
        break;
      }

      case 'textarea': {
        const area = document.createElement('textarea');
        area.className = 'textarea';
        area.placeholder = spec.placeholder ?? '';
        area.value = String(current ?? '');
        area.addEventListener('input', () => { target[spec.key] = area.value; });
        field.append(area);
        break;
      }

      case 'hotkey':
        field.append(this.#hotkeyInput(spec, target));
        break;

      case 'obs-scene':
        field.append(this.#datalistInput(spec, target, this.#context.obs?.scenes ?? []));
        break;

      case 'obs-input':
        field.append(this.#datalistInput(spec, target, this.#context.obs?.inputs ?? []));
        break;

      case 'window':
        field.append(this.#windowInput(spec, target));
        break;

      case 'deck-page': {
        const select = document.createElement('select');
        select.className = 'select';
        select.append(new Option('Proxima pagina', 'next'), new Option('Pagina anterior', 'prev'));
        for (const profile of this.#context.deck?.profiles ?? []) {
          for (const page of profile.pages) select.append(new Option(`${profile.name} · ${page.name}`, page.id));
        }
        select.value = String(current || 'next');
        select.addEventListener('change', () => { target[spec.key] = select.value; });
        target[spec.key] ??= select.value;
        field.append(select);
        break;
      }

      case 'deck-profile': {
        const select = document.createElement('select');
        select.className = 'select';
        for (const profile of this.#context.deck?.profiles ?? []) select.append(new Option(profile.name, profile.id));
        select.value = String(current || select.options[0]?.value || '');
        select.addEventListener('change', () => { target[spec.key] = select.value; });
        target[spec.key] ??= select.value;
        field.append(select);
        break;
      }

      case 'macro':
        field.append(this.#macroEditor(spec, target));
        break;

      default: {
        const input = document.createElement('input');
        input.className = 'input';
        input.type = 'text';
        input.placeholder = spec.placeholder ?? '';
        input.value = String(current ?? '');
        input.addEventListener('input', () => { target[spec.key] = input.value; });
        field.append(input);
      }
    }

    if (spec.placeholder && !['text', 'textarea'].includes(spec.type)) {
      const note = document.createElement('p');
      note.className = 'field__note';
      note.textContent = spec.placeholder;
      field.append(note);
    }
    return field;
  }

  /** Campo de atalho que aprende a combinacao com o proprio teclado. */
  #hotkeyInput(spec, target) {
    const row = document.createElement('div');
    row.className = 'row';

    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = spec.placeholder ?? 'ctrl+shift+f1';
    input.value = String(target[spec.key] ?? '');
    input.addEventListener('input', () => { target[spec.key] = input.value.trim(); });

    const capture = document.createElement('button');
    capture.type = 'button';
    capture.className = 'btn btn--ghost';
    capture.textContent = 'Gravar';
    capture.addEventListener('click', () => {
      capture.textContent = 'Pressione…';
      capture.classList.add('btn--primary');

      const onKey = (event) => {
        event.preventDefault();
        const parts = [];
        if (event.ctrlKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        if (event.metaKey) parts.push('win');

        const key = EditorSheet.#normalizeKey(event.key, event.code);
        // Modificador sozinho nao encerra a captura: espera a tecla principal.
        if (key) {
          parts.push(key);
          input.value = parts.join('+');
          target[spec.key] = input.value;
          capture.textContent = 'Gravar';
          capture.classList.remove('btn--primary');
          window.removeEventListener('keydown', onKey, true);
        }
      };
      window.addEventListener('keydown', onKey, true);
    });

    row.append(input, capture);
    return row;
  }

  static #normalizeKey(key, code) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
    const map = {
      ' ': 'space', Escape: 'esc', ArrowUp: 'up', ArrowDown: 'down',
      ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', Backspace: 'backspace',
      Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end',
      PageUp: 'pageup', PageDown: 'pagedown', Tab: 'tab', '+': 'plus', '-': 'minus'
    };
    if (map[key]) return map[key];
    if (/^F\d{1,2}$/.test(key)) return key.toLowerCase();
    if (key.length === 1) return key.toLowerCase();
    return code?.replace(/^Key|^Digit/, '').toLowerCase() || null;
  }

  #datalistInput(spec, target, options) {
    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = spec.placeholder ?? '';
    input.value = String(target[spec.key] ?? '');
    input.addEventListener('input', () => { target[spec.key] = input.value; });

    if (options.length) {
      const listId = `list-${Math.random().toString(36).slice(2, 9)}`;
      const datalist = document.createElement('datalist');
      datalist.id = listId;
      for (const option of options) datalist.append(new Option(option, option));
      input.setAttribute('list', listId);
      const holder = document.createElement('div');
      holder.append(input, datalist);
      return holder;
    }
    return input;
  }

  /** Campo de janela com sugestoes lidas do PC na hora. */
  #windowInput(spec, target) {
    const holder = document.createElement('div');
    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = spec.placeholder ?? 'chrome';
    input.value = String(target[spec.key] ?? '');
    input.addEventListener('input', () => { target[spec.key] = input.value; });
    holder.append(input);

    const datalist = document.createElement('datalist');
    datalist.id = `win-${Math.random().toString(36).slice(2, 9)}`;
    input.setAttribute('list', datalist.id);
    holder.append(datalist);

    const fill = (windows) => {
      const seen = new Set();
      datalist.replaceChildren();
      for (const window of windows) {
        if (seen.has(window.process)) continue;
        seen.add(window.process);
        datalist.append(new Option(`${window.process} — ${window.title}`, window.process));
      }
    };

    if (this.#windowsCache) {
      fill(this.#windowsCache);
    } else {
      this.#connection.request('/api/windows?force=1')
        .then((response) => { this.#windowsCache = response.windows; fill(response.windows); })
        .catch(() => {});
    }
    return holder;
  }

  /** Editor de macro: passos em linha, cada um com sua propria acao. */
  #macroEditor(spec, target) {
    const holder = document.createElement('div');
    target[spec.key] ??= [];

    const list = document.createElement('div');
    const redraw = () => {
      list.replaceChildren();
      target[spec.key].forEach((step, index) => {
        const row = document.createElement('div');
        row.className = 'macro-step';

        const badge = document.createElement('span');
        badge.className = 'macro-step__index';
        badge.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'macro-step__text';
        text.textContent = `${this.#labelFor(step.type)}${EditorSheet.#summarize(step.params)}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button';
        remove.append(IconLibrary.create('x'));
        remove.addEventListener('click', () => {
          target[spec.key].splice(index, 1);
          redraw();
        });

        row.append(badge, text, remove);
        list.append(row);
      });
    };

    // Passos aninhados nao podem ser macros: evita recursao acidental.
    const picker = document.createElement('select');
    picker.className = 'select';
    picker.append(new Option('Adicionar passo…', ''));
    for (const entry of this.#context.catalog ?? []) {
      if (entry.type === 'deck.macro') continue;
      picker.append(new Option(`${entry.group} · ${entry.label}`, entry.type));
    }

    const params = document.createElement('div');
    let pending = null;

    picker.addEventListener('change', () => {
      params.replaceChildren();
      if (!picker.value) { pending = null; return; }
      pending = { type: picker.value, params: {} };
      const definition = (this.#context.catalog ?? []).find((entry) => entry.type === picker.value);
      for (const field of definition?.fields ?? []) {
        if (field.default !== undefined) pending.params[field.key] = field.default;
        params.append(this.#renderFieldSpec(field, pending.params));
      }
      const confirm = this.#button('Incluir passo', 'btn btn--primary', () => {
        target[spec.key].push(pending);
        pending = null;
        picker.value = '';
        params.replaceChildren();
        redraw();
      });
      confirm.style.marginTop = '6px';
      params.append(confirm);
    });

    redraw();
    holder.append(list, picker, params);
    return holder;
  }

  #bindingField(draft) {
    const field = document.createElement('div');
    field.className = 'field';
    field.append(Object.assign(document.createElement('label'), { textContent: 'Acender quando' }));

    const select = document.createElement('select');
    select.className = 'select';
    const currentPrefix = String(draft.stateBinding ?? '').replace(/:(.*)$/, ':');
    for (const option of EditorSheet.BINDINGS) {
      const element = new Option(option.label, option.value);
      element.selected = option.value.endsWith(':')
        ? currentPrefix === option.value
        : option.value === draft.stateBinding;
      select.append(element);
    }

    const argument = document.createElement('input');
    argument.className = 'input';
    argument.placeholder = 'nome da cena ou entrada';
    argument.style.marginTop = '8px';
    argument.value = String(draft.stateBinding ?? '').split(/:(.+)/)[1] ?? '';

    const sync = () => {
      const needsArgument = select.value.endsWith(':');
      argument.hidden = !needsArgument;
      draft.stateBinding = needsArgument ? `${select.value}${argument.value}` : select.value;
    };

    select.addEventListener('change', sync);
    argument.addEventListener('input', sync);
    sync();

    const note = document.createElement('p');
    note.className = 'field__note';
    note.textContent = 'A tecla fica iluminada enquanto a condicao for verdadeira.';

    field.append(select, argument, note);
    return field;
  }

  /** Sugere a ligacao de estado coerente com a acao escolhida. */
  #suggestBinding(draft) {
    if (draft.stateBinding) return;
    const { type, params } = draft.action;
    const suggestions = {
      'obs.stream.toggle': 'obs.streaming',
      'obs.record.toggle': 'obs.recording',
      'obs.virtualcam.toggle': 'obs.virtualcam',
      'obs.replay.toggle': 'obs.replay',
      'obs.studio.toggle': 'obs.studio'
    };
    if (suggestions[type]) draft.stateBinding = suggestions[type];
    else if (type === 'obs.scene' && params.sceneName) draft.stateBinding = `obs.scene:${params.sceneName}`;
    else if (type === 'obs.input.mute' && params.inputName) draft.stateBinding = `obs.mute:${params.inputName}`;
  }

  #labelFor(type) {
    return (this.#context.catalog ?? []).find((entry) => entry.type === type)?.label ?? type;
  }

  static #summarize(params) {
    if (!params) return '';
    const parts = Object.entries(params)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([, value]) => String(value))
      .slice(0, 2);
    return parts.length ? ` · ${parts.join(', ')}` : '';
  }

  // =========================================================================
  //  Configuracoes
  // =========================================================================

  openSettings() {
    const { config, telemetry, obs, usb, server } = this.#context;
    const draft = structuredClone(config ?? {});

    const root = document.createElement('div');
    root.append(this.#title('settings', 'Configuracoes', 'Ajustes do servidor, sensores e conexao.'));

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const body = document.createElement('div');

    const panels = {
      Conexao: () => this.#connectionPanel(server, usb),
      OBS: () => this.#obsPanel(draft, obs),
      Sensores: () => this.#sensorsPanel(draft, telemetry),
      Paginas: () => this.#pagesPanel()
    };

    let activeName = 'Conexao';
    const draw = () => {
      for (const tab of tabs.children) tab.classList.toggle('is-active', tab.textContent === activeName);
      body.replaceChildren(panels[activeName]());
    };

    for (const name of Object.keys(panels)) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.textContent = name;
      tab.addEventListener('click', () => { activeName = name; draw(); });
      tabs.append(tab);
    }

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.append(
      this.#button('Fechar', 'btn', () => this.close()),
      this.#button('Salvar', 'btn btn--primary', async () => {
        await this.onSaveSettings({ obs: draft.obs, telemetry: draft.telemetry });
        this.close();
      })
    );

    root.append(tabs, body, buttons);
    draw();
    this.#open(root);
  }

  #connectionPanel(server = {}, usb = {}) {
    const panel = document.createElement('div');
    const transport = this.#connection.transport;

    panel.append(
      this.#kv('Como voce esta conectado',
        transport === 'usb' ? 'Cabo USB (adb reverse)' : transport === 'wifi' ? 'Wi-Fi / rede local' : 'Local (mesmo PC)',
        transport === 'usb' ? 'is-ok' : ''),
      this.#kv('Latencia', this.#connection.latencyMs === null ? 'medindo…' : `${this.#connection.latencyMs} ms`),
      this.#kv('Servidor', `${server.hostname ?? '—'}:${server.port ?? '—'}`),
      this.#kv('Aparelhos conectados', String(server.clients?.length ?? 0))
    );

    for (const address of server.addresses ?? []) {
      panel.append(this.#kv(`Endereco (${address.interface})`, `http://${address.address}:${server.port}`));
    }

    panel.append(this.#kv('Ponte USB (adb)',
      usb.bridged ? 'ativa' : usb.adbAvailable ? 'adb pronto, aguardando aparelho' : 'adb nao instalado',
      usb.bridged ? 'is-ok' : usb.adbAvailable ? '' : 'is-bad'));

    if (usb.lastError) panel.append(this.#kv('Aviso', usb.lastError, 'is-bad'));

    if (!usb.adbAvailable) {
      const callout = document.createElement('div');
      callout.className = 'callout';
      callout.style.marginTop = '14px';
      callout.innerHTML = 'Para usar <strong>cabo USB</strong>: instale o Android Platform Tools no PC, '
        + 'ligue a <strong>Depuracao USB</strong> no tablet e reconecte o cabo. '
        + 'O servidor aplica o <code>adb reverse</code> sozinho. Detalhes em <code>docs/CONEXAO.md</code>.';
      panel.append(callout);
    }

    const sync = this.#button('Reconectar cabo agora', 'btn', async () => {
      try {
        await this.#connection.request('/api/usb/sync', { method: 'POST', body: {} });
        this.#toaster.ok('Ponte USB atualizada');
      } catch (err) {
        this.#toaster.error(err.message);
      }
    });
    sync.style.marginTop = '14px';
    panel.append(sync);
    return panel;
  }

  #obsPanel(draft, obs = {}) {
    const panel = document.createElement('div');
    draft.obs ??= {};

    panel.append(
      this.#kv('Estado', obs.connected ? `conectado (OBS ${obs.obsVersion ?? '?'})` : (obs.lastError ?? 'desconectado'),
        obs.connected ? 'is-ok' : 'is-bad'),
      this.#kv('Cena atual', obs.currentScene ?? '—'),
      this.#kv('Cenas encontradas', String(obs.scenes?.length ?? 0))
    );

    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      this.#textField('Endereco', draft.obs.host ?? '127.0.0.1', (value) => { draft.obs.host = value; }),
      this.#textField('Porta', String(draft.obs.port ?? 4455), (value) => { draft.obs.port = Number(value); })
    );

    panel.append(
      document.createElement('br'),
      row,
      this.#textField('Senha do obs-websocket', draft.obs.password ?? '', (value) => { draft.obs.password = value; },
        'deixe como esta para nao alterar', 'password')
    );

    const callout = document.createElement('div');
    callout.className = 'callout callout--info';
    callout.innerHTML = 'No OBS: <strong>Ferramentas › Configuracoes do WebSocket</strong> › marque '
      + '<em>Ativar servidor WebSocket</em>. A porta padrao e 4455. Se houver senha, copie-a para o campo acima.';
    panel.append(callout);

    const reconnect = this.#button('Reconectar ao OBS', 'btn', async () => {
      try {
        await this.#connection.request('/api/obs/reconnect', { method: 'POST', body: {} });
        this.#toaster.ok('Tentando reconectar ao OBS…');
      } catch (err) {
        this.#toaster.error(err.message);
      }
    });
    reconnect.style.marginTop = '14px';
    panel.append(reconnect);
    return panel;
  }

  #sensorsPanel(draft, telemetry = {}) {
    const panel = document.createElement('div');
    draft.telemetry ??= {};

    for (const provider of telemetry.providers ?? []) {
      const friendly = provider.name === 'libre-hardware-monitor' ? 'LibreHardwareMonitor' : 'Windows (WMI)';
      panel.append(this.#kv(friendly, provider.available ? 'ativo' : (provider.error ?? 'indisponivel'),
        provider.available ? 'is-ok' : 'is-bad'));
    }

    const hasLhm = (telemetry.providers ?? []).some((p) => p.name === 'libre-hardware-monitor' && p.available);
    if (!hasLhm) {
      const callout = document.createElement('div');
      callout.className = 'callout';
      callout.style.margin = '14px 0';
      callout.innerHTML = '<strong>Temperatura indisponivel.</strong> O Windows nao expoe sensores termicos '
        + 'por API publica. Instale o <strong>LibreHardwareMonitor</strong>, ative '
        + '<em>Options › Remote Web Server › Run</em> (porta 8085) e marque <em>Run As Administrator</em>. '
        + 'Funciona com AMD, Intel e NVIDIA. Passo a passo em <code>docs/SENSORES.md</code>.';
      panel.append(callout);
    }

    panel.append(
      this.#textField('Intervalo de leitura (ms)', String(draft.telemetry.intervalMs ?? 1000),
        (value) => { draft.telemetry.intervalMs = Number(value); },
        'valores menores atualizam mais rapido e usam mais CPU'),
      this.#textField('URL do LibreHardwareMonitor', draft.telemetry.libreHardwareMonitorUrl ?? '',
        (value) => { draft.telemetry.libreHardwareMonitorUrl = value; })
    );
    return panel;
  }

  #pagesPanel() {
    const panel = document.createElement('div');
    const deck = this.#context.deck ?? {};

    for (const profile of deck.profiles ?? []) {
      for (const page of profile.pages) {
        const row = document.createElement('div');
        row.className = 'kv';
        const key = document.createElement('span');
        key.className = 'kv__key';
        key.textContent = `${profile.name} · ${page.name}`;
        const value = document.createElement('span');
        value.className = 'kv__value';
        value.textContent = `${page.columns}×${page.rows} · ${page.buttons.length} teclas`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button';
        remove.append(IconLibrary.create('trash'));
        remove.addEventListener('click', async () => {
          try {
            await this.onDeletePage(profile.id, page.id);
            this.#toaster.ok('Pagina removida');
            this.close();
          } catch (err) {
            this.#toaster.error(err.message);
          }
        });

        row.append(key, value, remove);
        panel.append(row);
      }
    }

    const name = document.createElement('input');
    name.className = 'input';
    name.placeholder = 'Nome da nova pagina';
    name.style.marginTop = '14px';

    const grid = document.createElement('div');
    grid.className = 'row';
    grid.style.marginTop = '8px';
    const columns = Object.assign(document.createElement('input'), { className: 'input', type: 'number', value: '4', min: '2', max: '8' });
    const rows = Object.assign(document.createElement('input'), { className: 'input', type: 'number', value: '3', min: '1', max: '6' });
    grid.append(columns, rows);

    const add = this.#button('Criar pagina', 'btn btn--primary', async () => {
      if (!name.value.trim()) { this.#toaster.error('Dê um nome a pagina'); return; }
      try {
        await this.onAddPage({
          profileId: deck.activeProfileId,
          name: name.value.trim(),
          columns: Number(columns.value),
          rows: Number(rows.value)
        });
        this.#toaster.ok('Pagina criada');
        this.close();
      } catch (err) {
        this.#toaster.error(err.message);
      }
    });
    add.style.marginTop = '10px';

    panel.append(name, grid, add);
    return panel;
  }

  // =========================================================================
  //  Auxiliares de construcao
  // =========================================================================

  #title(icon, text, hint) {
    const holder = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'sheet__title';
    title.append(IconLibrary.create(icon), document.createTextNode(text));
    holder.append(title);
    if (hint) {
      const paragraph = document.createElement('p');
      paragraph.className = 'sheet__hint';
      paragraph.textContent = hint;
      holder.append(paragraph);
    }
    return holder;
  }

  #textField(label, value, onInput, note = '', type = 'text') {
    const field = document.createElement('div');
    field.className = 'field';
    field.append(Object.assign(document.createElement('label'), { textContent: label }));
    const input = document.createElement('input');
    input.className = 'input';
    input.type = type;
    input.value = value ?? '';
    input.addEventListener('input', () => onInput(input.value));
    field.append(input);
    if (note) {
      const paragraph = document.createElement('p');
      paragraph.className = 'field__note';
      paragraph.textContent = note;
      field.append(paragraph);
    }
    return field;
  }

  #kv(key, value, valueClass = '') {
    const row = document.createElement('div');
    row.className = 'kv';
    const left = document.createElement('span');
    left.className = 'kv__key';
    left.textContent = key;
    const right = document.createElement('span');
    right.className = `kv__value ${valueClass}`.trim();
    right.textContent = value;
    row.append(left, right);
    return row;
  }

  #button(text, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await onClick();
      } catch (err) {
        this.#toaster.error(err.message);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }
}
