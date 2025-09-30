# ---------- Dev ----------
FROM node:20-alpine AS dev
WORKDIR /app
ENV CI=false
ENV PATH="/app/node_modules/.bin:${PATH}"

# Copiamos package.json de la API
COPY apps/api/package*.json ./
RUN npm install

# Prisma en raíz
COPY prisma ./prisma

# Config y código
COPY apps/api/tsconfig*.json ./
COPY apps/api/src ./src

EXPOSE 3000
CMD ["npm","run","start:dev"]
