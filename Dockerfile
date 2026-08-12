FROM node:22-alpine

WORKDIR /app

# deps first so Docker caches them across content-only changes
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

CMD ["node", "server.js"]
