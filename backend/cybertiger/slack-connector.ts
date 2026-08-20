const DEFAULT_MAX_MESSAGE_BYTES = 3_000;

function envBool(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function isAirGapped(): boolean {
  return envBool("GAUSS_AIR_GAP");
}

function configuredWebhook(): string | null {
  const webhook = (process.env.ORCHESTRATOR_SLACK_WEBHOOK_URL ?? "").trim();
  return webhook.startsWith("https://hooks.slack.com/") ? webhook : null;
}

export interface SlackConnector {
  notify(message: string): Promise<void>;
}

/**
 * Optional error notification boundary. It deliberately fails closed when
 * Slack is unset or the runtime is air-gapped, so backend startup and local
 * operation never depend on an external messaging service.
 */
export function getSlackConnector(): SlackConnector {
  const enabled = envBool("ORCHESTRATOR_SLACK_NOTIFICATIONS_ENABLED");
  const webhook = configuredWebhook();
  const maxBytes = Math.max(
    256,
    Number(process.env.ORCHESTRATOR_SLACK_MAX_MESSAGE_BYTES ?? DEFAULT_MAX_MESSAGE_BYTES) || DEFAULT_MAX_MESSAGE_BYTES,
  );

  return {
    async notify(message: string): Promise<void> {
      if (!enabled || !webhook || isAirGapped()) return;
      const bounded = Buffer.from(String(message), "utf8").subarray(0, maxBytes).toString("utf8");
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bounded }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`Slack notification failed with HTTP ${response.status}`);
      }
    },
  };
}
