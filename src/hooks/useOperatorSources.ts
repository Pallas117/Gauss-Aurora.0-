import { useCallback, useEffect, useState } from "react";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import {
    fetchDataSources,
    fetchSatelliteHardware,
    createDataSource,
    createSatelliteHardware,
    updateDataSource,
    updateSatelliteHardware,
    deleteDataSource,
    deleteSatelliteHardware,
    type OperatorDataSource,
    type OperatorSatelliteHardware,
    type DataSourceType,
    type SatelliteHardwareType,
} from "@/lib/api/operator-sources";
import { toast } from "sonner";

export type WizardStep = "choose" | "hardware" | "data_source" | "success_hardware" | "success_source";

export function useOperatorSources() {
    const mission = useMissionSnapshot();
    const isStaff = mission.session?.role === "admin" || mission.session?.role === "operator";

    const [dataSources, setDataSources] = useState<OperatorDataSource[]>([]);
    const [hardware, setHardware] = useState<OperatorSatelliteHardware[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState<WizardStep>("choose");
    const [submitLoading, setSubmitLoading] = useState(false);

    const [formName, setFormName] = useState("");
    const [formType, setFormType] = useState<DataSourceType | SatelliteHardwareType>("custom_url");
    const [formEndpointUrl, setFormEndpointUrl] = useState("");
    const [formDataSourceId, setFormDataSourceId] = useState("");
    const [formConnectionHint, setFormConnectionHint] = useState("");
    const [formEnabled, setFormEnabled] = useState(true);
    const [createdHardwareName, setCreatedHardwareName] = useState("");

    const refresh = useCallback(async () => {
        setError(null);
        setLoading(true);
        try {
            const [sources, hw] = await Promise.all([fetchDataSources(), fetchSatelliteHardware()]);
            setDataSources(sources);
            setHardware(hw);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isStaff) return;
        void refresh();
    }, [isStaff, refresh]);

    const openWizard = useCallback(() => {
        setWizardStep("choose");
        setFormName("");
        setFormType("custom_url");
        setFormEndpointUrl("");
        setFormDataSourceId("");
        setFormConnectionHint("");
        setFormEnabled(true);
        setCreatedHardwareName("");
        setDialogOpen(true);
    }, []);

    const handleChooseHardware = useCallback(() => {
        setWizardStep("hardware");
        setFormType("telemetry_source");
    }, []);
    const handleChooseDataSource = useCallback(() => {
        setWizardStep("data_source");
        setFormType("custom_url");
    }, []);

    const handleSubmitHardware = useCallback(async () => {
        if (!formName.trim()) {
            toast.error("Name is required");
            return;
        }
        setSubmitLoading(true);
        try {
            await createSatelliteHardware({
                name: formName.trim(),
                type: formType as SatelliteHardwareType,
                data_source_id: formDataSourceId.trim() || null,
                connection_hint: formConnectionHint.trim() || null,
                enabled: formEnabled,
            });
            setCreatedHardwareName(formName.trim());
            setWizardStep("success_hardware");
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create");
        } finally {
            setSubmitLoading(false);
        }
    }, [formName, formType, formDataSourceId, formConnectionHint, formEnabled, refresh]);

    const handleSubmitDataSource = useCallback(async () => {
        if (!formName.trim()) {
            toast.error("Name is required");
            return;
        }
        setSubmitLoading(true);
        try {
            await createDataSource({
                name: formName.trim(),
                type: formType as DataSourceType,
                endpoint_url: formEndpointUrl.trim() || null,
                enabled: formEnabled,
            });
            setWizardStep("success_source");
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create");
        } finally {
            setSubmitLoading(false);
        }
    }, [formName, formType, formEndpointUrl, formEnabled, refresh]);

    const handleToggleDataSource = useCallback(
        async (row: OperatorDataSource) => {
            try {
                await updateDataSource(row.id, { enabled: !row.enabled });
                toast.success(row.enabled ? "Data source disabled" : "Data source enabled");
                await refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to update");
            }
        },
        [refresh],
    );
    const handleDeleteDataSource = useCallback(
        async (row: OperatorDataSource) => {
            if (!confirm(`Delete data source "${row.name}"?`)) return;
            try {
                await deleteDataSource(row.id);
                toast.success("Data source deleted");
                await refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to delete");
            }
        },
        [refresh],
    );

    const handleToggleHardware = useCallback(
        async (row: OperatorSatelliteHardware) => {
            try {
                await updateSatelliteHardware(row.id, { enabled: !row.enabled });
                toast.success(row.enabled ? "Hardware disabled" : "Hardware enabled");
                await refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to update");
            }
        },
        [refresh],
    );
    const handleDeleteHardware = useCallback(
        async (row: OperatorSatelliteHardware) => {
            if (!confirm(`Remove "${row.name}" from the registry?`)) return;
            try {
                await deleteSatelliteHardware(row.id);
                toast.success("Hardware removed");
                await refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to delete");
            }
        },
        [refresh],
    );

    return {
        mission,
        isStaff,
        dataSources,
        hardware,
        loading,
        error,
        dialogOpen,
        setDialogOpen,
        wizardStep,
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
        formEnabled,
        setFormEnabled,
        createdHardwareName,
        refresh,
        openWizard,
        handleChooseHardware,
        handleChooseDataSource,
        handleSubmitHardware,
        handleSubmitDataSource,
        handleToggleDataSource,
        handleDeleteDataSource,
        handleToggleHardware,
        handleDeleteHardware,
    };
}
