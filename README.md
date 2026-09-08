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

`iniciar.bat` deixa uma janela de terminal aberta o tempo todo. Para rodar sem
essa janela, veja a seção **[Bandeja do sistema](#bandeja-do-sistema)** logo
abaixo.

---

## Bandeja do sistema

Alternativa ao `iniciar.bat` para quem deixa o Deck Control ligado o tempo
todo: em vez de uma janela de terminal, ele vira um ícone discreto perto do
relógio, com menu de clique direito.

**Para usar**: dê dois cliques em **`Deck Control.exe`**, na raiz do projeto.
Nenhuma janela aparece — nem de terminal, nem do PowerShell por trás.

> O Windows pode avisar "O Windows protegeu o computador" na primeira vez,
> porque o executável não tem assinatura digital (custa dinheiro e não faz
> sentido para um projeto pessoal). Clique em **Mais informações › Executar
> assim mesmo**. É um `.exe` pequeno (17 KB) compilado deste mesmo repositório
> — o código-fonte está em `tools/launcher/Launcher.cs`, dá para ler e
> recompilar você mesmo com `tools/build-launcher.ps1`.
>
> Se preferir não rodar um `.exe` desconhecido, `iniciar-bandeja.vbs` faz
> exatamente a mesma coisa (é texto puro, dá pra abrir num editor e ler).

O menu do ícone:

| Item | O que faz |
|---|---|
| **Abrir painel** | abre o endereço do Deck Control no navegador |
| Iniciar / Parar servidor | liga ou desliga o servidor |
| Reiniciar servidor | para e liga de novo (por exemplo, depois de mudar a porta) |
| Copiar endereço da rede | copia o link Wi-Fi para a área de transferência |
| Abrir pasta de dados | abre `server/data` no Explorer |
| Ver log | abre a saída do servidor no Bloco de Notas |
| Iniciar com o Windows | liga o ícone da bandeja sozinho a cada logon |
| Sair (não para o servidor) | fecha só o ícone — o servidor continua rodando |

O ícone muda de cor (colorido = rodando, cinza = parado) e mostra um aviso
quando o servidor fica pronto, para ou cai inesperadamente.

Se o servidor já estiver rodando por fora — por exemplo, você abriu
`iniciar.bat` antes — a bandeja detecta sozinha e passa a controlá-lo, sem
abrir uma segunda instância.

**"Parar servidor" desliga de verdade** (salva perfis e configuração antes de
sair) porque conversa com o próprio servidor pela rede — um processo sem
janela não recebe Ctrl+C, então fechar ali é sempre gracioso, nunca um
encerramento forçado. Só nos casos raros em que o servidor trava é que a
bandeja força o encerramento depois de alguns segundos de espera.

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
├── iniciar.bat              inicia o servidor (com terminal visível)
├── Deck Control.exe         inicia na bandeja do sistema (compilado, sem terminal)
├── iniciar-bandeja.vbs      mesma coisa que o .exe, como script
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
├── tools/                   tray.ps1, usb-connect.ps1, instalar-servico.ps1,
│                            build-launcher.ps1 + launcher/ (fonte do .exe)
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

**Não acho o ícone da bandeja.**
O Windows costuma esconder ícones novos atrás da setinha `^`, perto do
relógio. Clique nela e arraste o ícone do Deck Control para fora, se quiser
deixá-lo sempre visível.

**O Windows/antivírus avisa sobre `iniciar-bandeja.vbs` ou `tray.ps1`.**
Normal para scripts baixados da internet sem assinatura digital — são texto
puro, dá para abrir em qualquer editor e ler exatamente o que fazem. Escolha
"Executar mesmo assim" ou libere no antivírus.
