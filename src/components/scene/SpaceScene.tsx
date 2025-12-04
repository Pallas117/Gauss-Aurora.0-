import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Earth } from './Earth';
import { VanAllenBelts } from './VanAllenBelts';
import { Magnetosphere } from './Magnetosphere';

interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
}

interface SpaceSceneProps {
  layers: LayerVisibility;
  magnetopauseCompression: number;
  beltIntensity: number;
  reconnectionStrength: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

const SceneContent = ({
  layers,
  magnetopauseCompression,
  beltIntensity,
  reconnectionStrength,
}: Omit<SpaceSceneProps, 'canvasRef'>) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    // Subtle scene rotation for dynamic feel
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 3, 12]} fov={45} />
      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={30}
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.5}
      />

      {/* Ambient lighting */}
      <ambientLight intensity={0.1} />
      
      {/* Sun light from the right */}
      <directionalLight
        position={[20, 5, 10]}
        intensity={1.5}
        color="#fff5e6"
      />
      
      {/* Subtle fill light */}
      <pointLight position={[-10, 0, -10]} intensity={0.2} color="#4488ff" />

      {/* Stars background */}
      <Stars
        radius={100}
        depth={50}
        count={5000}
        factor={4}
        saturation={0}
        fade
        speed={0.5}
      />

      {/* Main scene group */}
      <group ref={groupRef}>
        <Earth visible={layers.earth} />
        
        <VanAllenBelts 
          visible={layers.belts} 
          intensity={0.5 + beltIntensity * 0.5}
        />
        
        <Magnetosphere
          visible={layers.magnetosphere || layers.fieldLines}
          compression={magnetopauseCompression}
          reconnectionStrength={reconnectionStrength}
        />
      </group>
    </>
  );
};

export const SpaceScene = (props: SpaceSceneProps) => {
  return (
    <Canvas
      ref={props.canvasRef}
      gl={{ 
        antialias: true, 
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      }}
      dpr={[1, 2]}
      className="w-full h-full"
    >
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  );
};
