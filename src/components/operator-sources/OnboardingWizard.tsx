import { Database, Loader2, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type {
    OperatorDataSource,
    DataSourceType,
    SatelliteHardwareType,
} from "@/lib/api/operator-sources";
import type { WizardStep } from "@/hooks/useOperatorSources";

interface OnboardingWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    step: WizardStep;
    submitLoading: boolean;
    formName: string;
    setFormName: (v: string) => void;
    formType: DataSourceType | SatelliteHardwareType;
    setFormType: (v: any) => void;
    formEndpointUrl: string;
    setFormEndpointUrl: (v: string) => void;
    formDataSourceId: string;
    setFormDataSourceId: (v: string) => void;
    formConnectionHint: string;
    setFormConnectionHint: (v: string) => void;
    createdHardwareName: string;
    dataSources: OperatorDataSource[];
    baseUrl: string;
    onChooseHardware: () => void;
    onChooseDataSource: () => void;
    onSubmitHardware: () => void;
    onSubmitDataSource: () => void;
}

const DATA_SOURCE_TYPES = [
    { value: "space_weather_feed", label: "Space weather feed" },
    { value: "mms_feed", label: "MMS feed" },
    { value: "telemetry_ingest", label: "Telemetry ingest" },
    { value: "custom_url", label: "Custom URL" },
];

const HARDWARE_TYPES = [
    { value: "ground_station", label: "Ground station" },
    { value: "antenna", label: "Antenna" },
    { value: "telemetry_source", label: "Telemetry source" },
    { value: "sensor", label: "Sensor" },
];

export function OnboardingWizard({
    open,
    onOpenChange,
    step,
    submitLoading,
    formName,
    setFormName,
    formType,
    setFormType,
    formEndpointUrl,
    setFormEndpointUrl,
    formDataSourceId,
    setFormDataSourceId,
    formConnectionHint,
    setFormConnectionHint,
    createdHardwareName,
    dataSources,
    baseUrl,
    onChooseHardware,
    onChooseDataSource,
    onSubmitHardware,
    onSubmitDataSource,
}: OnboardingWizardProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md text-foreground">
                <DialogHeader>
                    <DialogTitle>
                        {step === "choose" && "Add data source or onboard hardware"}
                        {step === "hardware" && "Onboard satellite hardware"}
                        {step === "data_source" && "Add data source"}
                        {step === "success_hardware" && "Hardware registered"}
                        {step === "success_source" && "Data source registered"}
                    </DialogTitle>
                </DialogHeader>

                {step === "choose" && (
                    <div className="space-y-3 py-2">
                        <p className="text-muted-foreground text-sm">Choose what to add:</p>
                        <div className="grid gap-2">
                            <Button
                                variant="outline"
                                className="justify-start h-auto py-3"
                                onClick={onChooseHardware}
                            >
                                <Satellite className="mr-2 h-4 w-4" />
                                Satellite / ground hardware (ground station, antenna, telemetry source)
                            </Button>
                            <Button
                                variant="outline"
                                className="justify-start h-auto py-3"
                                onClick={onChooseDataSource}
                            >
                                <Database className="mr-2 h-4 w-4" />
                                Data source (feed or API)
                            </Button>
                        </div>
                    </div>
                )}

                {step === "hardware" && (
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="hw-name">Name</Label>
                            <Input
                                id="hw-name"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g. Ground station Alpha"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={formType} onValueChange={setFormType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {HARDWARE_TYPES.map((t) => (
                                        <SelectItem key={t.value} value={t.value}>
                                            {t.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hw-datasource">Link to data source (optional)</Label>
                            <Select
                                value={formDataSourceId || "_none"}
                                onValueChange={(v) => setFormDataSourceId(v === "_none" ? "" : v)}
                            >
                                <SelectTrigger id="hw-datasource">
                                    <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="_none">None</SelectItem>
                                    {dataSources.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hw-hint">Connection hint (optional)</Label>
                            <Input
                                id="hw-hint"
                                value={formConnectionHint}
                                onChange={(e) => setFormConnectionHint(e.target.value)}
                                placeholder="e.g. POST to /api/ingest/telemetry/packets"
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={onSubmitHardware}
                                disabled={submitLoading || !formName.trim()}
                            >
                                {submitLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    "Register hardware"
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {step === "data_source" && (
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="ds-name">Name</Label>
                            <Input
                                id="ds-name"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g. Custom space weather API"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={formType} onValueChange={setFormType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATA_SOURCE_TYPES.map((t) => (
                                        <SelectItem key={t.value} value={t.value}>
                                            {t.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ds-endpoint">Endpoint URL (optional)</Label>
                            <Input
                                id="ds-endpoint"
                                value={formEndpointUrl}
                                onChange={(e) => setFormEndpointUrl(e.target.value)}
                                placeholder="https://..."
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={onSubmitDataSource}
                                disabled={submitLoading || !formName.trim()}
                            >
                                {submitLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    "Register data source"
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {step === "success_hardware" && (
                    <div className="space-y-4 py-2">
                        <p className="text-muted-foreground text-sm">
                            <strong className="text-foreground">{createdHardwareName}</strong> is registered.
                            To connect this hardware:
                        </p>
                        <div className="rounded bg-muted/50 p-3 text-xs font-mono space-y-1">
                            <p>POST telemetry to:</p>
                            <p className="break-all">{baseUrl}/api/ingest/telemetry/packets</p>
                            <p className="text-muted-foreground mt-2">
                                Use the service token from your environment (ORCHESTRATOR_INGEST_API_TOKEN) in
                                the request header <code>x-gauss-service-token</code>.
                            </p>
                        </div>
                        <DialogFooter>
                            <Button onClick={() => onOpenChange(false)}>Done</Button>
                        </DialogFooter>
                    </div>
                )}

                {step === "success_source" && (
                    <div className="space-y-4 py-2">
                        <p className="text-muted-foreground text-sm">
                            Data source registered. It will appear in the list above. Wiring into the
                            pipeline can be done in a future update.
                        </p>
                        <DialogFooter>
                            <Button onClick={() => onOpenChange(false)}>Done</Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
