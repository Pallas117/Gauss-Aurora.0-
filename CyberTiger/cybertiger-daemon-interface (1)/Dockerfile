FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

ENV NODE_ENV=production
ENV RAG_SERVER_PORT=3001

# GEMINI_API_KEY must be provided at runtime
EXPOSE 3001

CMD ["npm", "run", "rag-server"]

