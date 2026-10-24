FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
RUN mkdir -p data backups && chown node:node data backups
USER node
EXPOSE 3000
VOLUME ["/app/data", "/app/backups"]
CMD ["node", "server.js"]
