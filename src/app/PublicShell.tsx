import { Outlet } from "react-router-dom";
import { MissionSnapshotProvider } from "@/hooks/useMissionSnapshot";

export default function PublicShell() {
  return (
    <MissionSnapshotProvider mode="public">
      <Outlet />
    </MissionSnapshotProvider>
  );
}
