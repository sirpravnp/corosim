# CoroSim MCP server: Streamable HTTP for AI connectors, WebSocket rooms for live pages, REST/OpenAPI.
#   docker build -t corosim-mcp . && docker run -p 8787:8787 corosim-mcp
# Put it behind HTTPS (most hosts do this for you); Claude and ChatGPT connectors require https.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY tsconfig.json ./
COPY src ./src
RUN npx esbuild src/mcp/main.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist-mcp/corosim-mcp.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache su-exec && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist-mcp/corosim-mcp.mjs ./
# Connector patients are saved in /data so connectors survive restarts and deploys: mount a volume there.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 COROSIM_DATA_DIR=/data
# COROSIM_ALLOWED_ORIGINS=https://corosim.com,https://www.corosim.com   (pages allowed to open live rooms)
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1
# A mounted volume arrives owned by root: hand it to the unprivileged user, then run as that user.
CMD ["sh", "-c", "chown -R node:node /data 2>/dev/null; exec su-exec node node corosim-mcp.mjs --http"]
