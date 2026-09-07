# Conectando o tablet ao PC

Existem dois caminhos e eles funcionam ao mesmo tempo. Comece pelo Wi-Fi, que
não exige preparo, e adote o cabo se quiser latência menor ou se a rede for
instável.

---

## Opção A — Wi-Fi (mais simples)

**Requisito:** tablet e PC na mesma rede.

1. Inicie o servidor (`iniciar.bat`). Ele imprime algo assim:

   ```
   Pronto. Abra no tablet:

       Cabo USB   http://127.0.0.1:8787   (requer adb; veja docs/CONEXAO.md)
       Wi-Fi      http://192.168.1.200:8787   (Ethernet)
   ```

2. No tablet, abra o endereço de Wi-Fi no navegador.

3. Menu do navegador › **Adicionar à tela inicial**. O atalho abre em tela
   cheia, sem barra de endereço.

Com o APK instalado, nem isso: ele descobre o PC sozinho por uma sondagem UDP
na porta 8788.

### Se o tablet não achar

O culpado quase sempre é o Firewall do Windows.

```powershell
# Execute como administrador — libera o Node.js na rede privada
New-NetFirewallRule -DisplayName "Deck Control" -Direction Inbound `
  -Program "$((Get-Command node).Source)" -Action Allow -Profile Private
```

Confirme também que a rede está marcada como **Particular**, e não Pública:
*Configurações › Rede e Internet › Propriedades da rede*.

---

## Opção B — Cabo USB (menor latência)

O truque é o `adb reverse`: o Android encaminha uma porta local dele para a
mesma porta no PC. O tablet passa a acessar `http://127.0.0.1:8787` como se o
servidor rodasse dentro dele — sem Wi-Fi, sem IP, imune a oscilação de rede.

### 1. Ative a Depuração USB no tablet

1. *Configurações › Sobre o tablet*
2. Toque **7 vezes** em **Número da versão** → "Você agora é um desenvolvedor"
3. Volte para *Configurações › Sistema › Opções do desenvolvedor*
4. Ative **Depuração USB**

### 2. Prepare o PC

```powershell
cd tools
.\usb-connect.ps1
```

O script procura o `adb`. Se não encontrar, se oferece para baixar o pacote
oficial **Android Platform Tools** do Google (≈15 MB) — e só baixa se você
confirmar.

### 3. Conecte o cabo

Na primeira conexão o tablet mostra *"Permitir depuração USB?"*. Marque
**Sempre permitir deste computador** e toque em **Permitir**.

Pronto. No tablet, abra `http://127.0.0.1:8787` (ou apenas abra o APK).

### Reconexão automática

Com o `adb` instalado, o servidor detecta o aparelho e aplica o `adb reverse`
sozinho a cada 4 segundos — desconectar e reconectar o cabo funciona sem
nenhuma ação sua. O selo no topo do aplicativo mostra **USB** quando a ponte
está ativa.

Para desfazer manualmente:

```powershell
.\usb-connect.ps1 -Remove
```

### Quando o aparelho trava em `authorizing`, `offline` ou some da lista

Se o tablet aparece em `adb devices` mas nunca chega ao estado `device`, e o
aviso de autorização não surge nem com a tela desbloqueada, **provavelmente não
é o Android**. Antes de mexer em Opções do desenvolvedor, colete a evidência:

```powershell
$adb = "..\server\data\tools\platform-tools\adb.exe"
& $adb kill-server
$env:ADB_TRACE = 'all'
& $adb nodaemon server        # Ctrl+C depois de ~20 segundos
```

Procure no que for impresso:

| O que aparece | O que significa |
|---|---|
| `usb_read failed: Error [31]` | link USB instável — **cabo ou porta** |
| `Failed to get BOS header. Error: ... (31)` | falha de *control transfer*: camada física, não software |
| `Kicking USB device` em repetição | a conexão cai e é refeita sem parar |
| `packet <-- AUTH` seguido de silêncio | o handshake começa e é interrompido |

O erro **31** (`ERROR_GEN_FAILURE`) aponta para hardware, nesta ordem de
probabilidade:

1. **Cabo** — o mais comum. Muitos cabos que acompanham tablets são otimizados
   para carga e têm os pares de dados marginais. Teste outro cabo, de
   preferência um que você saiba que transfere arquivos bem.
2. **Hub ou painel frontal** — ligue direto na traseira da placa-mãe.
3. **Porta USB 3.0 (xHCI)** — aparelhos MediaTek costumam ser sensíveis. Tente
   uma porta USB 2.0.

Um sinal útil: se o dispositivo MTP ("Transferência de arquivos") também aparece
com status *Unknown* no Gerenciador de Dispositivos, o link está ruim para
tudo — não só para o ADB.

Nada disso impede o uso do deck: a conexão por **Wi-Fi** não depende do ADB, e a
**ancoragem USB** (Opção C, abaixo) usa o mesmo cabo por outro caminho.

---

## Opção C — Ancoragem USB (sem adb)

Se preferir não ativar a Depuração USB, dá para usar o tablet como interface de
rede:

1. Conecte o cabo
2. No tablet: *Configurações › Conexões › Roteador Wi-Fi e Ancoragem* →
   ative **Ancoragem USB**
3. O PC ganha um endereço na faixa `192.168.42.x`
4. No terminal do servidor aparecerá uma linha nova de Wi-Fi com esse endereço

O servidor prioriza endereços `192.168.42.x` na descoberta, justamente porque
costumam ser links USB.

A desvantagem: o tráfego de internet do tablet pode passar a sair pelo PC.

---

## Qual escolher

| Situação | Recomendação |
|---|---|
| Uso normal em casa | Wi-Fi |
| Transmissão ao vivo, sem margem para falha | Cabo USB (`adb reverse`) |
| Rede pública ou compartilhada | Cabo USB, e `server.host` em `127.0.0.1` |
| Não quer ativar Depuração USB | Wi-Fi, ou ancoragem USB |

---

## Vários aparelhos ao mesmo tempo

Não há limite: tablet, celular e o navegador do próprio PC podem ficar
conectados juntos. Todos veem o mesmo estado, e uma mudança feita em um aparece
nos outros na hora, pelo WebSocket.

O número de aparelhos conectados aparece em *Configurações › Conexão*.
