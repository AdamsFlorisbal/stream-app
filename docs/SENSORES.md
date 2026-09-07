# Temperaturas de CPU e GPU

## Por que precisa de um programa extra

O Windows não oferece nenhuma API pública para ler sensores térmicos. Os
valores vivem em chips de monitoramento da placa-mãe (Super I/O) e em registros
internos da CPU e da GPU, acessíveis apenas em modo kernel. Qualquer programa
que mostre temperatura no Windows — HWMonitor, HWiNFO, MSI Afterburner — carrega
um driver próprio para isso.

O Deck Control não instala driver nenhum. Em vez disso, ele lê os valores de um
programa que você já pode ter: o **LibreHardwareMonitor**, que é gratuito, de
código aberto e cobre **AMD, Intel e NVIDIA**.

**Sem ele, o que continua funcionando:** uso de CPU e GPU, memória, disco, rede
e tempo ligado — tudo isso vem do próprio Windows (CIM/WMI).
**O que fica indisponível:** temperaturas, rotação de ventoinhas, consumo em
watts e clocks.

---

## Instalação (2 minutos)

### 1. Baixe

<https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases>

Pegue o `LibreHardwareMonitor.zip` mais recente e extraia em uma pasta fixa —
por exemplo `C:\LibreHardwareMonitor`.

### 2. Execute como administrador

Clique com o botão direito em `LibreHardwareMonitor.exe` →
**Executar como administrador**.

Sem isso ele não consegue carregar o driver de leitura e a maior parte dos
sensores aparece vazia.

### 3. Ligue o servidor web

No menu do programa:

**Options › Remote Web Server › Port…** → deixe em `8085`
**Options › Remote Web Server › Run** → marque

Para conferir, abra no navegador do PC: <http://localhost:8085/data.json>.
Deve aparecer um JSON grande com os sensores.

### 4. Deixe tudo automático

Ainda no menu **Options**, marque:

- **Start Minimized**
- **Minimize To Tray**
- **Run On Windows Startup**

O programa passa a subir junto com o Windows e fica na bandeja.

### 5. Pronto

O Deck Control detecta sozinho, sem reiniciar nada. Em até 1 segundo as
temperaturas aparecem ao lado das porcentagens nos cartões de CPU e GPU.

Para conferir: **Configurações › Sensores** mostra
`LibreHardwareMonitor: ativo`.

---

## Como as fontes se combinam

O servidor lê as duas origens em paralelo e as mescla por prioridade:

| Origem | Prioridade | O que fornece |
|---|---|---|
| LibreHardwareMonitor | 100 | temperaturas, clocks, watts, ventoinhas, VRAM |
| Windows (CIM/WMI) | 10 | uso de CPU/GPU, RAM, disco, rede, tempo ligado |

A de maior prioridade define os valores; a outra apenas preenche o que ficou
faltando. Assim o LibreHardwareMonitor manda nas temperaturas enquanto o
Windows continua fornecendo disco e rede, que ele não reporta da mesma forma.

Se o LibreHardwareMonitor for fechado, a leitura cai para a origem do Windows
sozinha, sem erro e sem reiniciar o servidor.

---

## Sobre GPUs que não são NVIDIA

O uso da GPU funciona **sem nenhum programa extra**, em qualquer fabricante: o
servidor lê os contadores *GPU Engine* do Windows 10/11, que a Microsoft
alimenta pelo driver de display — os mesmos números do Gerenciador de Tarefas.

Já a **temperatura** da GPU depende do LibreHardwareMonitor em todas as marcas.
Ferramentas específicas de fabricante (como o `nvidia-smi`) foram deixadas de
fora justamente para não amarrar o projeto a uma marca.

---

## Alterar a porta

Se a 8085 já estiver ocupada, mude no LibreHardwareMonitor e informe a nova URL
em **Configurações › Sensores › URL do LibreHardwareMonitor**, ou direto em
`server/data/settings.json`:

```json
{
  "telemetry": {
    "intervalMs": 1000,
    "preferLibreHardwareMonitor": true,
    "libreHardwareMonitorUrl": "http://127.0.0.1:8085/data.json"
  }
}
```

---

## Números localizados

O LibreHardwareMonitor formata os valores com a cultura do Windows. Em
português, `62,4 °C` usa vírgula decimal e `4.550,1 MHz` usa ponto de milhar —
o inverso do inglês.

O servidor trata os dois formatos: quando há apenas um separador, a decisão vem
da quantidade de dígitos após ele (três indicam milhar, um ou dois indicam
decimal); quando há os dois, o que aparecer por último é o decimal. Não é
preciso mudar nada no idioma do sistema.
