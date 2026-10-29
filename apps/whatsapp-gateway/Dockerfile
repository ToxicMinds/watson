FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs filter.mjs sealed.mjs send.mjs ./
# The WhatsApp pairing is kept in Watson's database (sealed.mjs): Render's disk does not last.
USER node
CMD ["node", "server.mjs"]
