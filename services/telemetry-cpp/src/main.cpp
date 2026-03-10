/**
 * Minimal C++ telemetry consumer: read raw-telemetry from Kafka, extract speed from
 * first packet (canonical_point.solarWind.speed), write one point to InfluxDB,
 * produce same payload to derived-telemetry. Build: cmake -B build && cmake --build build
 * Requires: librdkafka-dev, libcurl4-openssl-dev (or libcurl-dev).
 */

#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>

#include <curl/curl.h>
#include <rdkafka.h>

static std::string g_influx_url;
static std::string g_influx_token;
static std::string g_influx_org;
static std::string g_influx_bucket;

static size_t curl_write_cb(char* ptr, size_t, size_t nmemb, void*) {
  (void)ptr;
  return nmemb;
}

static bool write_influx_point(double speed, int64_t ts_ns) {
  char line[256];
  snprintf(line, sizeof(line), "canonical,source=cpp speed=%.2f %lld", speed, (long long)ts_ns);
  std::string body(line);

  CURL* curl = curl_easy_init();
  if (!curl) return false;

  std::string url = g_influx_url + "/api/v2/write?org=" + g_influx_org + "&bucket=" + g_influx_bucket;
  struct curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, ("Authorization: Token " + g_influx_token).c_str());
  headers = curl_slist_append(headers, "Content-Type: text/plain; charset=utf-8");

  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curl_write_cb);

  CURLcode res = curl_easy_perform(curl);
  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);
  return (res == CURLE_OK);
}

static double extract_speed_from_json(const char* payload, size_t len) {
  const char* sentinel = payload + len;
  const char* p = payload;
  while (p < sentinel) {
    const char* q = static_cast<const char*>(memchr(p, '"', sentinel - p));
    if (!q || q + 10 > sentinel) break;
    if (strncmp(q + 1, "speed", 5) == 0 && q[6] == '"' && q[7] == ':') {
      double v = 0.0;
      if (sscanf(q + 8, "%lf", &v) == 1)
        return v;
    }
    p = q + 1;
  }
  return 400.0;
}

int main(int argc, char** argv) {
  const char* brokers = getenv("KAFKA_BROKERS");
  if (!brokers) brokers = "localhost:9092";
  g_influx_url = getenv("INFLUXDB_URL") ? getenv("INFLUXDB_URL") : "http://localhost:8086";
  g_influx_token = getenv("INFLUXDB_TOKEN") ? getenv("INFLUXDB_TOKEN") : "gauss-influx-admin-token";
  g_influx_org = getenv("INFLUXDB_ORG") ? getenv("INFLUXDB_ORG") : "gauss";
  g_influx_bucket = getenv("INFLUXDB_BUCKET") ? getenv("INFLUXDB_BUCKET") : "telemetry";

  rd_kafka_conf_t* conf = rd_kafka_conf_new();
  rd_kafka_conf_set(conf, "bootstrap.servers", brokers, nullptr, 0);
  rd_kafka_conf_set(conf, "group.id", "gauss-telemetry-cpp", nullptr, 0);
  rd_kafka_t* consumer = rd_kafka_new(RD_KAFKA_CONSUMER, conf, nullptr, 0);
  if (!consumer) {
    fprintf(stderr, "Failed to create consumer\n");
    return 1;
  }
  rd_kafka_topic_partition_list_t* topics = rd_kafka_topic_partition_list_new(1);
  rd_kafka_topic_partition_list_add(topics, "raw-telemetry", RD_KAFKA_PARTITION_UA);
  rd_kafka_subscribe(consumer, topics);
  rd_kafka_topic_partition_list_destroy(topics);

  rd_kafka_conf_t* pconf = rd_kafka_conf_new();
  rd_kafka_conf_set(pconf, "bootstrap.servers", brokers, nullptr, 0);
  rd_kafka_t* producer = rd_kafka_new(RD_KAFKA_PRODUCER, pconf, nullptr, 0);
  if (!producer) {
    fprintf(stderr, "Failed to create producer\n");
    rd_kafka_destroy(consumer);
    return 1;
  }

  curl_global_init(CURL_GLOBAL_DEFAULT);
  fprintf(stderr, "[telemetry-cpp] consuming raw-telemetry -> InfluxDB + derived-telemetry\n");

  while (true) {
    rd_kafka_message_t* rkm = rd_kafka_consumer_poll(consumer, 1000);
    if (!rkm) continue;
    if (rkm->err) {
      rd_kafka_message_destroy(rkm);
      continue;
    }
    const char* payload = static_cast<const char*>(rkm->payload);
    size_t len = rkm->len;
    double speed = extract_speed_from_json(payload, len);
    auto ts = std::chrono::system_clock::now().time_since_epoch();
    int64_t ts_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(ts).count();
    write_influx_point(speed, ts_ns);
    rd_kafka_topic_t* topic = rd_kafka_topic_new(producer, "derived-telemetry", nullptr);
    rd_kafka_producev(producer, RD_KAFKA_V_TOPIC(topic), RD_KAFKA_V_VALUE(payload, len), RD_KAFKA_V_END);
    rd_kafka_topic_destroy(topic);
    rd_kafka_poll(producer, 0);
    rd_kafka_message_destroy(rkm);
  }

  curl_global_cleanup();
  rd_kafka_destroy(producer);
  rd_kafka_destroy(consumer);
  return 0;
}
