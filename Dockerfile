# ============================================================================
#  Supervisório GP12 — imagem de produção.
#
#  Um processo só: Node servindo o build do cliente + WebSocket + fonte MQTT.
#  A porta vem de PORT (padrão 3001). Variáveis esperadas em produção:
#
#    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   trava de domínio (obrigatórias)
#    AUTH_DOMINIO=grupomultilaser.com.br
#    SESSION_SECRET=<aleatório longo>
#    BASE_URL=https://<url-publica>
#    MQTT_URL / MQTT_TOPICO                    broker (para o modo REAL)
# ============================================================================
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production

# O TETO VAI NA LINHA DE COMANDO, NAO EM NODE_OPTIONS.
#
# Variavel de ambiente e sobrescrivel pelo painel do host e some por completo
# se o servico nao estiver usando este Dockerfile - e um servico configurado
# como "Node" no Render ignora o Dockerfile inteiro, rodando `npm start`. Por
# isso o mesmo limite esta no script `start` do package.json: os dois caminhos
# de execucao levam ao mesmo lugar.
#
# Ver o comentario abaixo para a razao do numero.

# TETO DE HEAP ABAIXO DO LIMITE DO CONTAINER.
#
# Sem isto o V8 dimensiona o old space pela memoria que enxerga da MAQUINA, que
# no Render e muito maior que a cota da instancia. Ele entao nunca sente pressao
# e nunca dispara o mark-sweep completo: o scavenge roda (o dente de serra do
# grafico), promove sobreviventes para o old space, e o old space so cresce ate
# o CONTAINER matar o processo - antes de o V8 pensar em recolher.
#
# Era o padrao observado em 22/09/2026: dois picos que recolhiam, e um terceiro
# que subia sem parar ate ~476 MB de um limite de 512.
#
# 300 num limite de 512 deixa ~200 MB para o que nao e heap.
#
# Comecou em 384 e nao bastou: com o heap no teto o RSS chegou a 476 MB, ou
# seja, 36 MB de margem. Em 22/09/2026 dois picos da MESMA altura tiveram
# desfechos opostos - num a coleta chegou primeiro, no outro o container
# chegou primeiro. Margem de 36 MB e cara ou coroa.
#
# O numero so faz sentido em relacao ao tamanho da instancia: mexer num,
# conferir o outro.

EXPOSE 3001

# SEM tsx EM PRODUCAO. O bundle e gerado no build (npm run pacote-servidor),
# entao o compilador TypeScript nao precisa ficar residente na memoria de uma
# instancia de 512 MB - e a partida deixa de transpilar a cada boot.
CMD ["node", "--max-old-space-size=300", "dist-server/index.js"]
