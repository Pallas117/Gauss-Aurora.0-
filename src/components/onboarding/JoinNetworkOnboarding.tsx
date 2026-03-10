import { Button } from "@/components/ui/button";
import { createTuringJoinCode } from "@/lib/api/turing";
import { Copy, KeyRound, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { useCallback, useState } from "react";

const BACKEND_URL_PLACEHOLDER = (typeof import_meta !== 'undefined' ? import_meta?.env?.VITE_HELIO_PROXY_URL : typeof process !== 'undefined' ? process.env?.VITE_HELIO_PROXY_URL : undefined) ?? "https://your-backend-ip:3001";

export interface JoinNetworkOnboardingProps {
  /** "compact" for post-signup onboarding; "full" for Turing page */
  variant?: "compact" | "full";
  /** Show "Generate join code" (requires operator role for API) */
  showGenerateCode?: boolean;
  /** Show link to full Turing page */
  showTuringLink?: boolean;
}

export function JoinNetworkOnboarding({
  variant = "full",
  showGenerateCode = true,
  showTuringLink = true,
}: JoinNetworkOnboardingProps) {
  const [joinCode, setJoinCode] = useState<{ code: string; expires_at: string; expires_in_sec: number } | null>(null);
  const [joinCodeError, setJoinCodeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerateJoinCode = useCallback(async () => {
    setJoinCodeError(null);
    setLoading(true);
    try {
      const result = await createTuringJoinCode();
      setJoinCode(result);
    } catch (err) {
      setJoinCodeError(err instanceof Error ? err.message : "Failed to generate join code");
    } finally {
      setLoading(false);
    }
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const isCompact = variant === "compact";

  return (
    <div className="space-y-4 text-sm">
      {!isCompact && (
        <p className="text-muted-foreground">
          Any device can connect through the mesh after validation. Use a one-time join code (below) or have an operator approve the device after it registers.
        </p>
      )}
      {isCompact && (
        <p className="text-muted-foreground">
          Add devices (e.g. laptops, Raspberry Pi) to your Tailscale mesh so the mission can use them for cache and compute. Validated devices only (anti-botnet).
        </p>
      )}
      <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
        <li>
          <strong className="text-foreground">Install Tailscale</strong> on the device and join your tailnet (<code className="rounded bg-muted px-1">tailscale up</code>).
        </li>
        <li>
          <strong className="text-foreground">Get a join code</strong> — click &quot;Generate join code&quot; below (operator only). Valid 15 minutes, one-time use.
        </li>
        <li>
          <strong className="text-foreground">On the device</strong>, run the Turing agent with the join code:
          <pre className="mt-2 rounded bg-muted p-3 text-xs overflow-x-auto">
            export BACKEND_URL=&quot;{BACKEND_URL_PLACEHOLDER}&quot;{"\n"}
            export JOIN_CODE=&quot;&lt;paste code here&gt;&quot;{"\n"}
            export HOSTNAME=&quot;my-device&quot;{"\n"}
            ./scripts/turing/device-agent.sh
          </pre>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => copyToClipboard(`export BACKEND_URL="${BACKEND_URL_PLACEHOLDER}"\nexport JOIN_CODE="<paste code>"\nexport HOSTNAME="my-device"\n./scripts/turing/device-agent.sh`)}
          >
            <Copy className="h-3 w-3 mr-1" /> Copy template
          </Button>
        </li>
        {!isCompact && (
          <li>
            <strong className="text-foreground">Optional:</strong> run the cache server on the device:{" "}
            <code className="rounded bg-muted px-1">python3 scripts/turing/device-cache-server.py</code>
          </li>
        )}
      </ol>
      {showGenerateCode && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button size="sm" onClick={handleGenerateJoinCode} disabled={loading}>
            <KeyRound className="h-4 w-4 mr-2" />
            {loading ? "Generating…" : "Generate join code"}
          </Button>
          {joinCodeError && (
            <span className="text-destructive text-xs">{joinCodeError}</span>
          )}
        </div>
      )}
      {joinCode && (
        <div className="rounded border border-border bg-muted/30 p-3 space-y-1">
          <p className="text-xs text-muted-foreground">One-time code (valid for {joinCode.expires_in_sec}s):</p>
          <p className="font-mono text-lg font-semibold tracking-wider">{joinCode.code}</p>
          <p className="text-xs text-muted-foreground">Expires: {new Date(joinCode.expires_at).toLocaleString()}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(joinCode.code)}
          >
            <Copy className="h-3 w-3 mr-1" /> Copy code
          </Button>
        </div>
      )}
      {showTuringLink && (
        <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          <Link to="/ops/turing" className="text-primary hover:underline inline-flex items-center gap-1">
            <Server className="h-3 w-3" />
            Open Turing devices
          </Link>
          {" "}to see connected devices, approve pending ones, or revoke access.
        </p>
      )}
    </div>
  );
}
