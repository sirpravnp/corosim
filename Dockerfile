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
COPY --from=build /app/dist-mcp/corosim-mcp.mjs ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
# COROSIM_ALLOWED_ORIGINS=https://corosim.com,https://www.corosim.com   (pages allowed to open live rooms)
EXPOSE 8787
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1
CMD ["node", "corosim-mcp.mjs", "--http"]
