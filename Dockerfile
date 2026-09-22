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
# 384 deixa ~128 MB para o que nao e heap: buffers de socket, codigo nativo e o
# proprio tsx. Ajustar junto com o tamanho da instancia - o numero so faz
# sentido em relacao a ela.
ENV NODE_OPTIONS=--max-old-space-size=384

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
