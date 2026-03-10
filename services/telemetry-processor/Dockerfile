FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src/ src/
ENV KAFKA_BROKERS=kafka:9092
ENV INFLUXDB_URL=http://influxdb:8086
ENV INFLUXDB_TOKEN=gauss-influx-admin-token
ENV INFLUXDB_ORG=gauss
ENV INFLUXDB_BUCKET=telemetry
CMD ["node", "--import", "tsx", "src/index.ts"]
