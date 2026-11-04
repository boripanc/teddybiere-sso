FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
USER node
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
