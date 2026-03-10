/**
 * Telemetry processor: consume raw-telemetry from Kafka, compute/store canonical
 * telemetry in InfluxDB, produce to derived-telemetry. Runs as a separate process.
 */

import { InfluxDB, Point } from "@influxdata/influxdb-client";
import { Kafka } from "kafkajs";

const RAW_TOPIC = "raw-telemetry";
const DERIVED_TOPIC = "derived-telemetry";
const GROUP_ID = "gauss-telemetry-processor";

function env(name: string, def: string): string {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : def;
}

async function main(): Promise<void> {
  const brokers = env("KAFKA_BROKERS", "localhost:9092").split(",").map((s) => s.trim());
  const influxUrl = env("INFLUXDB_URL", "http://localhost:8086");
  const influxToken = env("INFLUXDB_TOKEN", "gauss-influx-admin-token");
  const influxOrg = env("INFLUXDB_ORG", "gauss");
  const influxBucket = env("INFLUXDB_BUCKET", "telemetry");

  const kafka = new Kafka({ clientId: "gauss-telemetry-processor", brokers });
  const admin = kafka.admin();
  await admin.connect();
  const existing = await admin.listTopics();
  for (const topic of [RAW_TOPIC, DERIVED_TOPIC]) {
    if (!existing.includes(topic)) {
      await admin.createTopics({ topics: [{ topic, numPartitions: 2 }] });
    }
  }
  await admin.disconnect();

  const consumer = kafka.consumer({ groupId: GROUP_ID });
  const producer = kafka.producer();

  const writeApi = new InfluxDB({ url: influxUrl, token: influxToken }).getWriteApi(influxOrg, influxBucket, "ns");

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: RAW_TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const value = message.value?.toString();
      if (!value) return;
      try {
        const payload = JSON.parse(value) as {
          run_id?: string;
          source?: string;
          packets?: Array<{
            timestamp?: string;
            canonical_point?: {
              solarWind?: { speed?: number; density?: number };
              magneticField?: { z?: number };
            };
          }>;
        };
        const packets = Array.isArray(payload.packets) ? payload.packets : [];
        for (const packet of packets) {
          const ts = packet.timestamp ?? new Date().toISOString();
          const cp = packet.canonical_point;
          const speed = typeof cp?.solarWind?.speed === "number" ? cp.solarWind.speed : 0;
          const density = typeof cp?.solarWind?.density === "number" ? cp.solarWind.density : 0;
          const bz = typeof cp?.magneticField?.z === "number" ? cp.magneticField.z : 0;
          const t = new Date(ts).getTime() * 1_000_000;
          const point = new Point("canonical")
            .timestamp(new Date(t / 1_000_000))
            .tag("source", payload.source ?? "unknown")
            .tag("run_id", payload.run_id ?? "")
            .floatField("speed", speed)
            .floatField("density", density)
            .floatField("bz", bz);
          writeApi.writePoint(point);
        }
        writeApi.flush().catch((e) => console.warn("[influx] flush error", e));

        await producer.send({
          topic: DERIVED_TOPIC,
          messages: [{ key: message.key ?? Buffer.from(Date.now().toString()), value: message.value }],
        });
      } catch (err) {
        console.warn("[processor] parse/send error:", err instanceof Error ? err.message : err);
      }
    },
  });

  console.log("[telemetry-processor] consuming", RAW_TOPIC, "-> InfluxDB +", DERIVED_TOPIC);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
