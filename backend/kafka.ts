/**
 * Kafka producer for bxr stack. Produces to raw-telemetry topic when KAFKA_BROKERS is set.
 * Lazy init; fire-and-forget produce so ingest response is not blocked.
 */

import { Kafka, type Producer, type ProducerRecord } from "kafkajs";

const RAW_TELEMETRY_TOPIC = "raw-telemetry";

let producer: Producer | null = null;
let initPromise: Promise<Producer | null> | null = null;

function getBrokers(): string[] | null {
  const raw = process.env.KAFKA_BROKERS ?? "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

async function ensureProducer(): Promise<Producer | null> {
  const brokers = getBrokers();
  if (!brokers) {
    return null;
  }
  if (producer) {
    return producer;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const kafka = new Kafka({
        clientId: "gauss-ingest-gateway",
        brokers,
      });
      const admin = kafka.admin();
      await admin.connect();
      const existing = await admin.listTopics();
      if (!existing.includes(RAW_TELEMETRY_TOPIC)) {
        await admin.createTopics({ topics: [{ topic: RAW_TELEMETRY_TOPIC, numPartitions: 2 }] });
      }
      await admin.disconnect();
      const p = kafka.producer();
      await p.connect();
      producer = p;
      return p;
    } catch (err) {
      console.warn("[kafka] producer connect failed:", err instanceof Error ? err.message : err);
      initPromise = null;
      return null;
    }
  })();
  return initPromise;
}

/**
 * Produce ingest payload to raw-telemetry. Does not throw; logs on failure.
 * Payload is the validated packet ingest request (run_id, source, format, dictionary_id, packets).
 */
export async function produceRawTelemetry(payload: unknown): Promise<void> {
  const p = await ensureProducer();
  if (!p) {
    return;
  }
  try {
    const record: ProducerRecord = {
      topic: RAW_TELEMETRY_TOPIC,
      messages: [
        {
          key: Buffer.from(`${Date.now()}`),
          value: Buffer.from(JSON.stringify(payload), "utf8"),
        },
      ],
    };
    await p.send(record);
  } catch (err) {
    console.warn("[kafka] produce raw-telemetry failed:", err instanceof Error ? err.message : err);
  }
}

export function isKafkaConfigured(): boolean {
  return getBrokers() !== null;
}
