FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "server.js"]