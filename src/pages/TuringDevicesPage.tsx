import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpsLaneLinks } from "@/components/ops/OpsLaneLinks";
import {
  useTuringDevices,
} from "@/hooks/useTuringDevices";
import {
  approveTuringDevice,
  revokeTuringDevice,
  removeTuringDevice,
  fetchTuringDeviceHealth,
  triggerTuringDeviceHeal,
} from "@/lib/api/turing";
import type { TuringDevice } from "@/lib/contracts/turing";
import { JoinNetworkOnboarding } from "@/components/onboarding/JoinNetworkOnboarding";
import { RefreshCw, Server, ShieldCheck, CheckCircle2, XCircle, Trash2, Heart, Stethoscope } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

function statusVariant(status: TuringDevice["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "healthy") return "secondary";
  if (status === "stale") return "outline";
  return "destructive";
}

function formatLastSeen(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const ageMs = now - date.getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86400_000) return `${Math.round(ageMs / 3600_000)}h ago`;
  return date.toLocaleString();
}

export default function TuringDevicesPage() {
  const { devices, summary, loading, error, refresh } = useTuringDevices();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleApprove = useCallback(async (deviceId: string) => {
    setActionLoading(deviceId);
    try {
      await approveTuringDevice(deviceId);
      await refresh();
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const handleRevoke = useCallback(async (deviceId: string) => {
    setActionLoading(deviceId);
    try {
      await revokeTuringDevice(deviceId);
      await refresh();
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const handleRemove = useCallback(async (deviceId: string) => {
    if (!confirm("Remove this device from the pool? It will need to register again to rejoin.")) return;
    setActionLoading(deviceId);
    try {
      await removeTuringDevice(deviceId);
      await refresh();
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const handleCheckHealth = useCallback(async (deviceId: string) => {
    setActionLoading(deviceId);
    try {
      const health = await fetchTuringDeviceHealth(deviceId);
      const parts = [];
      if (health.ram_used_mb != null) parts.push(`RAM used: ${health.ram_used_mb} MB`);
      if (health.load != null) parts.push(`Load: ${health.load}`);
      toast.success(parts.length ? parts.join(", ") : "Device OK", { description: "Health check from agent" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleHeal = useCallback(async (deviceId: string) => {
    setActionLoading(deviceId);
    try {
      const result = await triggerTuringDeviceHeal(deviceId);
      const msg = result.expired_cleared != null
        ? `Heal completed (${result.expired_cleared} expired cache entries cleared)`
        : (result.message ?? "Heal completed");
      toast.success(msg, { description: "Device healing via agent" });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Heal failed");
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  return (
    <div className="space-y-4">
      <OpsLaneLinks compact showHub />
      <section className="grid gap-4 lg:grid-cols-1" data-testid="turing-devices-page">
        {/* Join the network — step-by-step + join code (shared with onboarding) */}
        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Join the network (anti-botnet: validated devices only)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <JoinNetworkOnboarding
            variant="full"
            showGenerateCode={true}
            showTuringLink={false}
          />
        </CardContent>
        </Card>

        {/* Device health card */}
        <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" />
              Turing device health
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive text-xs">
              {error}
            </div>
          )}
          {summary && (
            <p className="text-muted-foreground">
              {summary.total === 0
                ? "No Turing devices registered. Use the steps above to join a device with a join code."
                : `${summary.total} device${summary.total !== 1 ? "s" : ""} — ${summary.healthy} healthy${summary.stale > 0 ? `, ${summary.stale} stale` : ""}${summary.offline > 0 ? `, ${summary.offline} offline` : ""}${(summary.pending ?? 0) > 0 ? ` · ${summary.pending} pending approval` : ""}.`}
            </p>
          )}
        </CardContent>
        </Card>

        {devices.length === 0 && !loading && !error && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No devices yet. Generate a join code above and run the device agent on a machine on your Tailscale network.
            </CardContent>
          </Card>
        )}

        {devices.length > 0 && (
          <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Devices (approval required; health and healing via agent)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded border border-border/70">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border/70">
                    <th className="px-2 py-2 text-left font-medium">Hostname</th>
                    <th className="px-2 py-2 text-left font-medium">Tailscale IP</th>
                    <th className="px-2 py-2 text-left font-medium">Approval</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-left font-medium">Last seen</th>
                    <th className="px-2 py-2 text-right font-medium">RAM</th>
                    <th className="px-2 py-2 text-left font-medium">Capabilities</th>
                    <th className="px-2 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="border-b border-border/40">
                      <td className="px-2 py-2 font-medium">{d.hostname}</td>
                      <td className="px-2 py-2 font-mono">{d.tailscale_ip}</td>
                      <td className="px-2 py-2">
                        {d.approval_status === "approved" ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Approved
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <XCircle className="h-3 w-3" /> Pending
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{formatLastSeen(d.last_seen)}</td>
                      <td className="px-2 py-2 text-right">
                        {d.ram_mb != null
                          ? d.ram_used_mb != null
                            ? `${d.ram_used_mb} / ${d.ram_mb} MB`
                            : `${d.ram_mb} MB`
                          : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {d.capabilities.length > 0 ? d.capabilities.join(", ") : "—"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={actionLoading !== null}
                            onClick={() => void handleCheckHealth(d.id)}
                            title="Check device health (via agent)"
                          >
                            {actionLoading === d.id ? "…" : <Stethoscope className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={actionLoading !== null}
                            onClick={() => void handleHeal(d.id)}
                            title="Run device heal (clear expired cache via agent)"
                          >
                            <Heart className="h-3 w-3" />
                          </Button>
                          {d.approval_status === "pending" && (
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              disabled={actionLoading !== null}
                              onClick={() => void handleApprove(d.id)}
                            >
                              {actionLoading === d.id ? "…" : "Approve"}
                            </Button>
                          )}
                          {d.approval_status === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={actionLoading !== null}
                              onClick={() => void handleRevoke(d.id)}
                            >
                              {actionLoading === d.id ? "…" : "Revoke"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            disabled={actionLoading !== null}
                            onClick={() => void handleRemove(d.id)}
                            title="Remove from pool"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
