# Deck Control

Transforma um tablet ou celular Android em um Stream Deck para o seu PC:
atalhos de teclado, controle do OBS, troca de janelas e de áreas de trabalho,
volume, e telemetria do computador em tempo real (CPU, GPU, RAM, disco, rede e
temperaturas).

Funciona **por cabo USB** ou **pela rede Wi-Fi** — os dois caminhos, sem
configuração manual de IP.

---

## Início rápido (3 passos)

1. **No PC**, dê dois cliques em `iniciar.bat`.
   Na primeira vez ele instala as dependências sozinho.

2. Anote o endereço que aparecer no terminal, por exemplo
   `http://192.168.1.200:8787`.

3. **No tablet**, abra esse endereço no navegador e escolha
   *Adicionar à tela inicial* — ele vira um app em tela cheia.
   Ou instale o APK (veja [docs/APK.md](docs/APK.md)), que encontra o PC sozinho.

Pré-requisito: [Node.js](https://nodejs.org) 18 ou superior.

---

## Os dois modos de conexão

| | Cabo USB | Wi-Fi |
|---|---|---|
| Latência | menor, constante | depende da rede |
| Estabilidade | não cai | oscila com o sinal |
| Preparo | ativar Depuração USB uma vez | nenhum |
| Carrega o tablet | sim | não |

Ambos ficam disponíveis ao mesmo tempo. O passo a passo de cada um está em
**[docs/CONEXAO.md](docs/CONEXAO.md)**.

---

## O que dá para colocar nas teclas

**OBS Studio** (15 ações) — trocar de cena, iniciar/parar live e gravação,
pausar gravação, câmera virtual, replay buffer, mostrar/ocultar fontes,
mudo de entradas, volume, ligar/desligar filtros, transição e modo estúdio.
As teclas **acendem sozinhas** quando a cena entra no ar ou a gravação começa.

**Teclado** — qualquer combinação (`ctrl+shift+f1`), digitar textos prontos,
teclas de mídia.

**Janelas** — focar um programa pelo nome, alternar entre janelas do mesmo
programa, trocar de área de trabalho virtual.

**Sistema** — abrir programas e links, volume e mudo do Windows (entrada e
saída), brilho da tela, bloquear, suspender, desligar monitores.

**Deck** — trocar de página ou perfil e **macros** (várias ações em sequência,
com pausa configurável entre elas).

Ícones podem ser vetoriais (56 inclusos) ou **GIFs animados, PNG, WebP e vídeos**
enviados do próprio tablet.

---

## Personalizar

Toque no ícone de lápis (canto superior direito) para entrar no modo edição:

- **Toque** em uma tecla para editá-la
- **Segure** uma tecla, a qualquer momento, para abrir o editor
- **Arraste** para reposicionar
- O `+` ao lado das abas cria páginas novas

Tudo é salvo em `server/data/profiles.json`. Dá para copiar esse arquivo para
outro PC.

---

## Temperaturas de CPU e GPU

O Windows não expõe sensores térmicos por API pública — nenhum programa
consegue lê-los sem um driver em modo kernel. Por isso o Deck Control usa o
**LibreHardwareMonitor** como fonte, quando ele está presente:

- funciona com **AMD, Intel e NVIDIA**;
- é detectado automaticamente, sem configurar nada;
- se não estiver instalado, o resto da telemetria continua funcionando
  (uso de CPU/GPU, RAM, disco e rede vêm do próprio Windows).

Instalação em 2 minutos: **[docs/SENSORES.md](docs/SENSORES.md)**.

---

## Estrutura

```
stream-app/
├── iniciar.bat              inicia o servidor
├── server/
│   ├── src/
│   │   ├── main.js          raiz de composição (monta o grafo de objetos)
│   │   ├── core/            Logger, EventBus
│   │   ├── config/          Paths, AppConfig, ProfileStore (persistência JSON)
│   │   ├── platform/        ponte com o Windows (entrada, janelas, áudio)
│   │   ├── telemetry/       provedores de sensores + serviço de polling
│   │   ├── integrations/    ObsController (obs-websocket v5)
│   │   ├── actions/         registry + handlers por domínio
│   │   ├── media/           biblioteca de ícones enviados
│   │   └── net/             HTTP, WebSocket, descoberta UDP, ponte USB
│   ├── scripts/agent.ps1    agente PowerShell persistente (P/Invoke)
│   ├── public/              interface (PWA, sem dependências externas)
│   └── data/                configuração, perfis e mídia — seus arquivos
├── android/                 projeto do APK (WebView + descoberta)
├── tools/                   usb-connect.ps1, instalar-servico.ps1
└── docs/
```

Detalhes de arquitetura em **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

---

## Segurança

O servidor digita teclas e abre programas na sua máquina, então ele:

- **não envia cabeçalhos CORS permissivos** — um site aberto no seu navegador
  não consegue disparar ações em `127.0.0.1`;
- **recusa requisições com `Origin` de outra procedência** (HTTP 403);
- **exige `Content-Type: application/json`** nas rotas que alteram estado, o que
  um formulário de outro site não consegue enviar sem preflight;
- **pede confirmação explícita** para ações destrutivas (suspender o PC,
  desligar monitores);
- aceita um **PIN opcional** (`security.pin` em `server/data/settings.json`).

Ele escuta em `0.0.0.0` para que o tablet o alcance. Em rede pública, use o
cabo USB e mude `server.host` para `127.0.0.1`.

---

## Solução de problemas

**O tablet não acha o PC.**
Firewall do Windows: libere o Node.js na rede privada. Teste primeiro no
navegador do próprio PC: `http://127.0.0.1:8787`.

**"OBS off" no topo.**
No OBS: *Ferramentas › Configurações do WebSocket* › marque *Ativar servidor
WebSocket*. Se houver senha, copie-a em Configurações › OBS no aplicativo.

**Atalhos não chegam em um jogo.**
Jogos em tela cheia exclusiva costumam ignorar entrada sintética. Mude para
*fullscreen sem bordas*.

**Temperatura aparece como "—".**
Esperado sem o LibreHardwareMonitor. Veja [docs/SENSORES.md](docs/SENSORES.md).

**Brilho aparece como "n/d".**
Controle por software só existe em telas internas (notebooks) e em monitores
com DDC/CI. Em desktop com monitor externo comum, não há como.
