# Arquitetura

Projeto orientado a objetos, com uma classe por responsabilidade e **injeção de
dependências pelo construtor**. Nenhuma classe instancia as próprias
dependências: todas as ligações acontecem em `server/src/main.js`, a raiz de
composição. Isso deixa a ordem de inicialização visível em um único lugar e
permite testar qualquer peça isolada, trocando uma dependência por um dublê.

---

## Visão geral

```
      Tablet / navegador
              │  HTTP (configuração) + WebSocket (tempo real)
              ▼
    ┌─────────────────────────────────────────────┐
    │  HttpServer ── Router ── ApiController       │  segurança, rotas
    │  RealtimeGateway                            │  push de estado
    │  DiscoveryBeacon (UDP)   UsbBridge (adb)     │  descoberta e cabo
    ├─────────────────────────────────────────────┤
    │  ActionRegistry                             │  despacho de ações
    │    ├── InputActionHandler                   │
    │    ├── WindowActionHandler                  │
    │    ├── SystemActionHandler                  │
    │    ├── ObsActionHandler                     │
    │    └── DeckActionHandler                    │
    ├─────────────────────────────────────────────┤
    │  WindowsInput   WindowManager               │  fachadas de plataforma
    │  AudioMixer     SystemControl               │
    │              └── PowerShellHost             │
    │  ObsController                              │
    │  TelemetryService ── SensorProvider*        │
    └─────────────────────────────────────────────┘
              │                       │
              ▼                       ▼
        agent.ps1 (P/Invoke)     OBS / LibreHardwareMonitor
```

---

## Decisões que moldaram o projeto

### Um agente PowerShell persistente, não um `spawn` por ação

`agent.ps1` sobe uma vez e fica vivo, conversando com o Node por JSON-linha em
stdin/stdout. Um `Start-Process powershell` custa cerca de 200 ms e o agente
ainda compila C# na inicialização — pagar isso por clique deixaria o deck
perceptivelmente lento. Com o processo persistente, cada ação vira uma
ida-e-volta de poucos milissegundos.

`PowerShellHost` correlaciona requisições por id, aplica tempo limite e
reinicia o agente com recuo exponencial se ele cair.

### P/Invoke em vez de dependências nativas de npm

Entrada de teclado (`SendInput`), enumeração de janelas (`EnumWindows`) e volume
(CoreAudio) são feitos por interoperabilidade nativa compilada em tempo de
execução pelo `Add-Type`. Nada de módulos npm com binários pré-compilados, que
quebram entre versões do Node e exigem ferramentas de build no PC do usuário.

O código C# fica restrito a **C# 5**, porque o compilador embutido no
PowerShell 5.1 não vai além disso — sem descartes (`out _`), sem interpolação de
strings, sem `?.`.

### Provedores de sensores substituíveis

`SensorProvider` é uma classe abstrata com `probe()` e `read()`. Existem duas
implementações — `LibreHardwareMonitorProvider` (prioridade 100) e
`WmiSensorProvider` (prioridade 10) — e o `TelemetryService` lê ambas em
paralelo e mescla por prioridade: a de maior prioridade define os valores, a
outra só preenche lacunas.

Uma fonte nova (um agente para uma AIO específica, por exemplo) só precisa
estender a classe e ser registrada. Nada mais no sistema muda.

### O catálogo de ações vem do servidor

Cada handler implementa `describe()`, devolvendo os campos que a ação precisa.
`ActionRegistry.catalog()` junta tudo, e o editor de teclas do aplicativo
constrói os formulários a partir dessa descrição.

Consequência prática: **criar uma ação nova no backend a torna editável no
tablet sem tocar em uma linha de interface**.

### O OBS espelhado por eventos, não por polling

`ObsController` mantém uma cópia local do estado do OBS (cena atual, live,
gravação, mudos, volumes) atualizada pelos eventos do obs-websocket. É isso que
permite às teclas acenderem em tempo real quando algo muda **dentro do próprio
OBS**, e não só quando a mudança parte do deck.

O campo `stateBinding` de cada tecla (`obs.scene:Live`, `obs.recording`, …) é
avaliado contra esse espelho.

### Descoberta por UDP, não por mDNS

mDNS/Bonjour depende de um serviço do sistema que costuma estar desativado no
Windows e traria mais dependências. Um socket UDP responde à sondagem
`DECK-CONTROL-DISCOVER/1` e anuncia sua presença a cada 10 segundos — cerca de
90 linhas, sem nenhuma dependência.

---

## Segurança

Concentrada no `HttpServer`, porque um servidor que digita teclas na sua máquina
é um alvo interessante para qualquer site aberto no navegador:

| Defesa | Contra o quê |
|---|---|
| Sem CORS permissivo | leitura de respostas por outro site |
| `Origin` de outra procedência → 403 | requisições disparadas por outro site |
| `Content-Type: application/json` obrigatório em escritas | CSRF por formulário HTML |
| `confirm: true` em ações destrutivas | toque acidental suspender o PC |
| Bloqueio de travessia de diretório | leitura de `settings.json` via `/media/..` |
| PIN opcional | acesso na mesma rede |

Uploads validam **assinatura de arquivo**, não apenas o `Content-Type`, e o nome
enviado nunca vira nome de arquivo — ele é saneado e prefixado com um id.

---

## Persistência

`JsonStore` é a classe base de `AppConfig` e `ProfileStore`. Ela faz escrita
atômica (arquivo temporário + rename) com gravação adiada de 250 ms, e move
arquivos corrompidos para `.bak` em vez de derrubar o servidor. No desligamento
há um `flushSync()` — perder a configuração do usuário seria o pior resultado
possível de um encerramento.

---

## Interface

Sem framework e sem nenhuma requisição externa: o servidor roda na rede local e
o tablet pode estar offline. Fontes são a pilha do sistema, e os 56 ícones são
caminhos SVG embutidos em `IconLibrary`.

Cada componente (`KeyGrid`, `DialStrip`, `TelemetryPanel`, `EditorSheet`) é uma
classe que emite eventos e recebe dados. Eles não conversam entre si — o
`DeckApp` fecha o circuito com o servidor. Os elementos do DOM são criados uma
única vez e apenas os valores mudam a cada atualização; recriar o DOM a 1 Hz
causaria piscadas visíveis no tablet.

---

## Extensões prováveis

**Nova ação:** crie um handler estendendo `ActionHandler`, declare `types` e
`describe()`, e registre em `main.js`. O editor do aplicativo passa a oferecê-la
automaticamente.

**Novo tipo de knob:** adicione o caso em `ApiController.rotateDial()` e
`readDial()`.

**Nova fonte de sensores:** estenda `SensorProvider` e registre no
`TelemetryService` com a prioridade adequada.

**Novo transporte:** `RealtimeGateway` recebe um `snapshotProvider` e fala com o
`ActionRegistry` — outro transporte (MQTT, BLE) só precisa dessas duas peças.
