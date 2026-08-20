import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RadiationRiskActivityPanel() {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Radiation risk activity</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">Awaiting bounded monitoring evidence.</CardContent></Card>;
}
