# Tarefas futuras

Ideias registradas para depois. Nada aqui está em andamento.

---

## Status do Deck Control no Amazon Echo Spot

**Situação:** ainda não decidido se será feito.

**Problema:** as skills da Alexa rodam na nuvem da Amazon e não alcançam o
servidor na rede local do PC. Por isso não basta ligar o Echo na mesma rede.

**Abordagem proposta:**

1. O servidor envia (push) um resumo do status para uma endpoint na nuvem a
   cada ~5 segundos: temperatura de CPU/GPU, uso de RAM, estado do OBS
   (ao vivo / gravando) e conexão. Só saída, sem abrir porta no roteador.
2. Endpoint pequena na nuvem (AWS Lambda + DynamoDB, ou similar) guarda o
   último status, protegida por token secreto.
3. Skill Alexa com APL (Alexa Presentation Language) lê o status e desenha na
   tela do Echo Spot. Invocação por voz, por exemplo "Alexa, abre Deck Control".

**Cuidados:**

- Não expor o servidor na internet (ngrok, port forwarding). Ele digita teclas
  e pode desligar o PC.
- A tela do Echo Spot é pequena e redonda (2,5"). O visual deve ser mínimo:
  indicador de OBS, temperatura e uso de CPU/GPU.
- Não confirmado: se a tela pode ficar atualizando sozinha, ou se só aparece
  enquanto a skill está aberta.
- Não confirmado na documentação da Amazon: suporte a APL no Echo Spot.

**Precisa:**

- Conta de desenvolvedor Amazon (gratuita).
- Conta AWS (free tier cobre este uso).
- Decidir quais dados mostrar na tela.

**Primeiro passo, se for feito:** módulo no servidor que faz o push do status,
com endpoint e token configuráveis em `settings.json`.
