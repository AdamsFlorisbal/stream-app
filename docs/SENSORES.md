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

## Instalação automática (recomendado)

```powershell
cd tools
.\instalar-sensores.ps1
```

O script baixa a última versão do LibreHardwareMonitor (pedindo sua
confirmação), configura o servidor web na porta 8085, registra uma tarefa
agendada que o inicia **com privilégio elevado no logon** — de modo que o aviso
do UAC não reaparece a cada reinício — e o inicia imediatamente.

Ele pede elevação uma única vez, para registrar a tarefa. Para desfazer:

```powershell
.\instalar-sensores.ps1 -Remove
```

Se preferir fazer à mão, o passo a passo está abaixo.

---

## Instalação manual

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

## Armadilhas na leitura do `data.json`

O formato do LibreHardwareMonitor tem três detalhes que quebram um parser
ingênuo. Todos já estão tratados em `LibreHardwareMonitorProvider`, mas ficam
registrados aqui porque reaparecem em qualquer código que consuma esse JSON.

**1. Nem todo sensor em °C é uma temperatura.** Um SSD publica
`Warning Temperature = 89 °C` e `Critical Temperature = 94 °C` — limites do
fabricante, não leituras. A CPU publica `Distance to TjMax`, que é a *folga*
térmica. Agregar por máximo sem filtrar faz a interface anunciar o disco a
94 °C com a máquina ociosa. O provedor exclui esses nomes por
`NOT_A_READING`.

**2. Nós de memória se parecem, mas não servem para a mesma coisa.** Existem
`Total Memory` (uso real da RAM física), `Virtual Memory` (inclui o arquivo de
paginação) e um nó por pente (`DIMM #0`, `DIMM #2`) que só expõe capacidade e
timings. Escolher pelo ícone `ram.png` pode cair num DIMM e reportar "16 GB em
uso" quando 16 GB é apenas a capacidade daquele pente. A escolha é validada por
capacidade: só serve o nó que tem um sensor `Memory` ou `Memory Used`.

**3. Nomes de modelo colidem com padrões de chipset.** `Intel Arc B580` casa
com uma expressão pensada para placas-mãe B550/B650, e a GPU acaba
classificada como placa-mãe. A solução não é refinar a expressão, e sim
classificar em ordem de precedência retirando do conjunto o nó que já foi
reivindicado — assim a GPU nunca chega à etapa da placa-mãe.

Vale notar que o nome do hardware pode ser inútil: uma CPU de engenharia se
identifica como `Genuine Intel 0000`, sem modelo. Por isso o ícone
(`images_icon/cpu.png`) entra como desempate.

---

## Números localizados

O LibreHardwareMonitor formata os valores com a cultura do Windows. Em
português, `62,4 °C` usa vírgula decimal e `4.550,1 MHz` usa ponto de milhar —
o inverso do inglês.

O servidor trata os dois formatos: quando há apenas um separador, a decisão vem
da quantidade de dígitos após ele (três indicam milhar, um ou dois indicam
decimal); quando há os dois, o que aparecer por último é o decimal. Não é
preciso mudar nada no idioma do sistema.
