FROM node:22-alpine

WORKDIR /app
COPY sentinela ./sentinela
COPY servidor ./servidor

ENV PORTA=3000 \
    HOST=0.0.0.0 \
    SENTINELA_DADOS=/dados \
    SENTINELA_ESTATICOS=/app/sentinela

RUN mkdir -p /dados && addgroup -S app && adduser -S app -G app && chown -R app /dados
USER app
VOLUME ["/dados"]
EXPOSE 3000

CMD ["node", "servidor/src/principal.js"]
