import Layout from "@/app/Layout";
import { MissionSnapshotProvider } from "@/hooks/useMissionSnapshot";

export default function MissionShell() {
  return (
    <MissionSnapshotProvider mode="mission">
      <Layout />
    </MissionSnapshotProvider>
  );
}
