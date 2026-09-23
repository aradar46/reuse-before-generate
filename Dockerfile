FROM node:22-alpine

WORKDIR /app

COPY package.json index.js LICENSE README.md ./

USER node

ENTRYPOINT ["node", "index.js"]
