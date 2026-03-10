import { useMemo, useState } from "react";
import { createOrbitCollisionThreat, createOrbitDemoAssets, createOrbitDemoTrajectories } from "./template/demo-data";
import { OrbitSceneViewport } from "./template/OrbitSceneViewport";
import { OrbitTemplateShell } from "./template/OrbitTemplateShell";

export {
  MVLine,
  MVPlane,
  MVPoint,
  MVVolume,
  Transform,
  type Vec3,
} from "./template/primitives";

export default function ORBITTemplate() {
  const [canvasOK, setCanvasOK] = useState(true);

  const assets = useMemo(() => createOrbitDemoAssets(), []);
  const trajectories = useMemo(() => createOrbitDemoTrajectories(assets), [assets]);
  const threat = useMemo(() => createOrbitCollisionThreat(), []);

  return (
    <OrbitTemplateShell
      assets={assets}
      trajectories={trajectories}
      threat={threat}
      webglOK
      canvasOK={canvasOK}
      sceneContent={
        <OrbitSceneViewport
          assets={assets}
          trajectories={trajectories}
          threat={threat}
          onFatal={() => setCanvasOK(false)}
        />
      }
    />
  );
}
