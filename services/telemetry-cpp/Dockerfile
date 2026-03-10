FROM ubuntu:22.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libcurl4-openssl-dev \
    librdkafka-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY CMakeLists.txt ./
COPY src/main.cpp src/
RUN cmake -B build && cmake --build build && mv build/telemetry-cpp /app/
CMD ["/app/telemetry-cpp"]
ENV KAFKA_BROKERS=kafka:9092
ENV INFLUXDB_URL=http://influxdb:8086
ENV INFLUXDB_TOKEN=gauss-influx-admin-token
ENV INFLUXDB_ORG=gauss
ENV INFLUXDB_BUCKET=telemetry
