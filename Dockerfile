# Build stage: compile TypeScript with dev dependencies present.
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so the dependency layer caches independently of source.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies and compiled output only.
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as the unprivileged user that the node image already provides.
USER node

# The server speaks JSON-RPC over stdin/stdout. It takes no arguments and
# listens on no port — the MCP client owns the pipe.
ENTRYPOINT ["node", "dist/index.js"]
