import { Database, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OperatorDataSource } from "@/lib/api/operator-sources";

interface DataSourceTableProps {
    dataSources: OperatorDataSource[];
    loading: boolean;
    onToggle: (row: OperatorDataSource) => void;
    onDelete: (row: OperatorDataSource) => void;
}

export function DataSourceTable({
    dataSources,
    loading,
    onToggle,
    onDelete,
}: DataSourceTableProps) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Data sources
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                    </div>
                ) : dataSources.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">
                        No data sources registered yet. Add one via the button above.
                    </p>
                ) : (
                    <div className="overflow-auto rounded border border-border/70">
                        <table className="w-full border-collapse text-xs">
                            <thead className="sticky top-0 bg-background">
                                <tr className="border-b border-border/70">
                                    <th className="px-2 py-2 text-left font-medium">Name</th>
                                    <th className="px-2 py-2 text-left font-medium">Type</th>
                                    <th className="px-2 py-2 text-left font-medium">Endpoint</th>
                                    <th className="px-2 py-2 text-left font-medium">Status</th>
                                    <th className="px-2 py-2 text-right font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dataSources.map((row) => (
                                    <tr key={row.id} className="border-b border-border/40">
                                        <td className="px-2 py-2 font-medium">{row.name}</td>
                                        <td className="px-2 py-2">{row.type}</td>
                                        <td className="px-2 py-2 text-muted-foreground truncate max-w-[12rem]">
                                            {row.endpoint_url ?? "—"}
                                        </td>
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
