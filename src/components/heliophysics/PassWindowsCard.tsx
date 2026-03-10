import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PassWindowsCardProps {
    passes: any[];
}

export const PassWindowsCard = ({ passes }: PassWindowsCardProps) => {
    if (passes.length === 0) return null;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Pass windows (2D)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
                {passes.slice(0, 6).map((p) => (
                    <div key={p.passId} className="rounded border border-border/50 bg-background/30 px-2 py-1">
                        <span className="font-medium">{p.target}</span> @ {p.station} · {p.status} · AOS{" "}
                        {new Date(p.aos).toLocaleTimeString()} – LOS {new Date(p.los).toLocaleTimeString()}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};
