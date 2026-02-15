FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /work
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN node build.mjs
ENV ALL_BROWSERS=1
CMD ["bash", "-c", "pnpm exec playwright test --workers=4"]
