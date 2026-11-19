FROM node:20-bookworm-slim
# iproute2 aporta `tc` (traffic control) para simular pérdida, latencia y ancho de banda
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY simulador.ts tsconfig.json ./
ENTRYPOINT ["npx", "tsx", "simulador.ts"]
