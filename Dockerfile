FROM node:22-alpine

WORKDIR /app

# deps first so Docker caches them across content-only changes.
# O lockfile VAI junto e o install é `npm ci`: sem ele o build resolvia
# tudo de novo a cada deploy, e as versões fixadas aqui não chegavam em
# produção — inclusive as transitivas, que voltariam para a mais nova
# publicada no dia do build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

CMD ["node", "server.js"]
