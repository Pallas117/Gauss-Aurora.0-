import { Link } from "react-router-dom";
import { Database, RefreshCw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpsLaneLinks } from "@/components/ops/OpsLaneLinks";
import { getApiBaseUrl } from "@/lib/api/base-url";
import { useOperatorSources } from "@/hooks/useOperatorSources";

// Atomized Components
import { DataSourceTable } from "@/components/operator-sources/DataSourceTable";
import { HardwareTable } from "@/components/operator-sources/HardwareTable";
import { OnboardingWizard } from "@/components/operator-sources/OnboardingWizard";

const BASE_URL = getApiBaseUrl();

export default function OperatorSourcesPage() {
  const {
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
  } = useOperatorSources();

  if (!mission.session?.authRequired) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Auth must be enabled to use this page.</p>
        <Button variant="outline" size="sm" asChild className="mt-2 text-foreground">
          <Link to="/command">Back to Command</Link>
        </Button>
      </div>
    );
  }

  if (!mission.session?.authenticated) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Sign in to access data sources and hardware.</p>
        <Button variant="outline" asChild className="mt-2 text-foreground">
          <Link to="/heliophysics">Go to mission console</Link>
        </Button>
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Operator or admin role required.</p>
        <Button variant="outline" asChild className="mt-2 text-foreground">
          <Link to="/command">Back to Command</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <OpsLaneLinks compact showHub />
      <section className="space-y-6" data-testid="operator-sources-page">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data sources &amp; satellite hardware
          </h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading} className="text-foreground">
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={openWizard}>
              <Plus className="mr-2 h-4 w-4" />
              Add data source or onboard hardware
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          Register data sources (feeds, APIs) and satellite hardware (ground stations, antennas) so operators can connect them seamlessly.
        </p>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
            {error}
          </div>
        )}

        <DataSourceTable
          dataSources={dataSources}
          loading={loading}
          onToggle={handleToggleDataSource}
          onDelete={handleDeleteDataSource}
        />

        <HardwareTable
          hardware={hardware}
          loading={loading}
          onToggle={handleToggleHardware}
          onDelete={handleDeleteHardware}
        />

        <OnboardingWizard
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          step={wizardStep}
          submitLoading={submitLoading}
          formName={formName}
          setFormName={setFormName}
          formType={formType}
          setFormType={setFormType}
          formEndpointUrl={formEndpointUrl}
          setFormEndpointUrl={setFormEndpointUrl}
          formDataSourceId={formDataSourceId}
          setFormDataSourceId={setFormDataSourceId}
          formConnectionHint={formConnectionHint}
          setFormConnectionHint={setFormConnectionHint}
          createdHardwareName={createdHardwareName}
          dataSources={dataSources}
          baseUrl={BASE_URL}
          onChooseHardware={handleChooseHardware}
          onChooseDataSource={handleChooseDataSource}
          onSubmitHardware={handleSubmitHardware}
          onSubmitDataSource={handleSubmitDataSource}
        />
      </section>
    </div>
  );
}
