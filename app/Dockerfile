FROM node:22-alpine
# ffmpeg (marca d'água em vídeos/imagens) e poppler-utils (PDF -> páginas)
RUN apk add --no-cache ffmpeg poppler-utils
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package.json ./
COPY src ./src
COPY public ./public
COPY assets ./assets
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
