FROM node:24-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

FROM node:24-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
# Carpeta de fotos de productos: el volumen 'uploads' hereda este dueno al montarse por primera vez
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3003
CMD ["node", "src/server.js"]
