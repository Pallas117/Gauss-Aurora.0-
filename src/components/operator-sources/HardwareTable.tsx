import { Loader2, Satellite, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OperatorSatelliteHardware } from "@/lib/api/operator-sources";

interface HardwareTableProps {
    hardware: OperatorSatelliteHardware[];
    loading: boolean;
    onToggle: (row: OperatorSatelliteHardware) => void;
    onDelete: (row: OperatorSatelliteHardware) => void;
}

export function HardwareTable({
    hardware,
    loading,
    onToggle,
    onDelete,
}: HardwareTableProps) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <Satellite className="h-4 w-4" />
                    Satellite hardware
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                    </div>
                ) : hardware.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">
                        No satellite hardware registered yet. Onboard hardware via the button above.
                    </p>
                ) : (
                    <div className="overflow-auto rounded border border-border/70">
                        <table className="w-full border-collapse text-xs">
                            <thead className="sticky top-0 bg-background">
                                <tr className="border-b border-border/70">
                                    <th className="px-2 py-2 text-left font-medium">Name</th>
                                    <th className="px-2 py-2 text-left font-medium">Type</th>
                                    <th className="px-2 py-2 text-left font-medium">Status</th>
                                    <th className="px-2 py-2 text-right font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hardware.map((row) => (
                                    <tr key={row.id} className="border-b border-border/40">
                                        <td className="px-2 py-2 font-medium">{row.name}</td>
                                        <td className="px-2 py-2">{row.type}</td>
                                        <td className="px-2 py-2">
                                            <Badge variant={row.enabled ? "secondary" : "outline"}>
                                                {row.enabled ? "Enabled" : "Disabled"}
                                            </Badge>
                                        </td>
                                        <td className="px-2 py-2 text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-1"
                                                onClick={() => onToggle(row)}
                                            >
                                                {row.enabled ? "Disable" : "Enable"}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-1 text-destructive"
                                                onClick={() => onDelete(row)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
