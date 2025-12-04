import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface MagnetosphereProps {
  visible: boolean;
  compression: number;
  reconnectionStrength: number;
}

export const Magnetosphere = ({ visible, compression, reconnectionStrength }: MagnetosphereProps) => {
  const magnetopauseRef = useRef<THREE.Mesh>(null);
  const fieldLinesRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Mesh>(null);

  // Create magnetopause geometry using Shue model approximation
  const magnetopauseGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const segments = 64;
    const rings = 32;
    const vertices: number[] = [];
    const indices: number[] = [];

    // Shue model parameters (simplified)
    const r0 = 10 * compression; // Standoff distance
    const alpha = 0.5;

    for (let i = 0; i <= rings; i++) {
      const theta = (i / rings) * Math.PI - Math.PI / 2;
      
      for (let j = 0; j <= segments; j++) {
        const phi = (j / segments) * Math.PI * 2;
        
        // Shue model: r = r0 * (2 / (1 + cos(theta)))^alpha
        const cosTheta = Math.cos(theta);
        const r = theta > 0 
          ? r0 * Math.pow(2 / (1 + cosTheta), alpha)
          : r0 * Math.pow(2 / (1 + cosTheta), alpha) * (1 + theta * 0.3); // Tail stretching

        const x = r * Math.cos(theta) * Math.cos(phi);
        const y = r * Math.sin(theta);
        const z = r * Math.cos(theta) * Math.sin(phi);

        vertices.push(x, y, z);

        if (i < rings && j < segments) {
          const current = i * (segments + 1) + j;
          const next = current + segments + 1;

          indices.push(current, next, current + 1);
          indices.push(current + 1, next, next + 1);
        }
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }, [compression]);

  const magnetopauseMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        compression: { value: compression },
        reconnection: { value: reconnectionStrength },
        baseColor: { value: new THREE.Color('#00d4ff') },
        glowColor: { value: new THREE.Color('#00ffff') },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vFresnel;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          
          vec3 viewDir = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
          vFresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float compression;
        uniform float reconnection;
        uniform vec3 baseColor;
        uniform vec3 glowColor;
        
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vFresnel;
        
        void main() {
          float flow = sin(vPosition.x * 0.5 - time * 0.5) * 0.5 + 0.5;
          float pulse = sin(time * 2.0 + vPosition.y * 0.3) * 0.3 + 0.7;
          
          vec3 color = mix(baseColor, glowColor, vFresnel * 0.5 + flow * 0.2);
          color += glowColor * reconnection * 0.5;
          
          float alpha = vFresnel * 0.4 * pulse;
          alpha = clamp(alpha, 0.05, 0.5);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [compression, reconnectionStrength]);

  // Field lines
  const fieldLines = useMemo(() => {
    const lines: THREE.Vector3[][] = [];
    const numLines = 12;

    for (let i = 0; i < numLines; i++) {
      const phi = (i / numLines) * Math.PI * 2;
      const points: THREE.Vector3[] = [];

      for (let t = -Math.PI / 2; t <= Math.PI / 2; t += 0.1) {
        const r = 1.2 + Math.abs(Math.sin(t)) * 2;
        const x = r * Math.cos(t) * Math.cos(phi);
        const y = r * Math.sin(t) * 2;
        const z = r * Math.cos(t) * Math.sin(phi);
        points.push(new THREE.Vector3(x, y, z));
      }

      lines.push(points);
    }

    return lines;
  }, []);

  useFrame((state) => {
    if (magnetopauseMaterial) {
      magnetopauseMaterial.uniforms.time.value = state.clock.elapsedTime;
      magnetopauseMaterial.uniforms.compression.value = compression;
      magnetopauseMaterial.uniforms.reconnection.value = reconnectionStrength;
    }
    if (fieldLinesRef.current) {
      fieldLinesRef.current.rotation.y += 0.001;
    }
  });

  if (!visible) return null;

  return (
    <group>
      {/* Magnetopause surface */}
      <mesh
        ref={magnetopauseRef}
        geometry={magnetopauseGeometry}
        material={magnetopauseMaterial}
        rotation={[0, Math.PI / 2, 0]}
      />

      {/* Field lines */}
      <group ref={fieldLinesRef}>
        {fieldLines.map((points, index) => (
          <line key={index}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={points.length}
                array={new Float32Array(points.flatMap(p => [p.x, p.y, p.z]))}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color="#00d4ff"
              transparent
              opacity={0.3}
              linewidth={1}
            />
          </line>
        ))}
      </group>

      {/* Magnetotail (simplified) */}
      <mesh ref={tailRef} position={[-15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[3, 20, 32, 1, true]} />
        <meshBasicMaterial
          color="#00d4ff"
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};
