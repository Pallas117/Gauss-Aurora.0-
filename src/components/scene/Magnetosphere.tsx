import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface MagnetosphereProps {
  visible: boolean;
  compression: number;
  reconnectionStrength: number;
}

/**
 * Generate dipole field line points following r = L * cos²(λ)
 */
function generateDipoleFieldLine(
  L: number,
  phi: number,
  steps: number,
  isOpen: boolean,
  tailLength: number
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  
  const latRange = isOpen ? 75 : 85; // degrees
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lambda = (t - 0.5) * 2 * latRange * (Math.PI / 180);
    const cosLambda = Math.cos(lambda);
    const cos2Lambda = cosLambda * cosLambda;
    
    let r = L * cos2Lambda;
    
    // For open field lines, stretch toward tail on nightside
    if (isOpen && Math.abs(lambda) > 60 * Math.PI / 180) {
      const stretch = (Math.abs(lambda) - 60 * Math.PI / 180) / (15 * Math.PI / 180);
      r += stretch * tailLength * Math.sign(Math.cos(phi) < 0 ? -1 : 0);
    }
    
    const x = r * cosLambda * Math.cos(phi);
    const y = r * Math.sin(lambda);
    const z = r * cosLambda * Math.sin(phi);
    
    points.push(new THREE.Vector3(x, y, z));
  }
  
  return points;
}

/**
 * Create magnetotail geometry - elongated parabolic cavity
 */
function createMagnetotailGeometry(
  length: number,
  startRadius: number,
  segments: number,
  rings: number
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // Parabolic flaring: radius increases slowly then more at the end
    const x = -startRadius - t * length;
    const flareFactor = 1 + t * 0.3 + t * t * 0.5;
    const radius = startRadius * flareFactor;
    
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const y = radius * Math.sin(theta);
      const z = radius * Math.cos(theta);
      
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
}

export const Magnetosphere = ({ visible, compression, reconnectionStrength }: MagnetosphereProps) => {
  const magnetopauseRef = useRef<THREE.Mesh>(null);
  const fieldLinesRef = useRef<THREE.Group>(null);

  // Create magnetopause geometry using Shue model approximation
  const magnetopauseGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const segments = 64;
    const rings = 32;
    const vertices: number[] = [];
    const indices: number[] = [];

    // Shue model parameters
    const r0 = 10 * compression;
    const alpha = 0.5;

    for (let i = 0; i <= rings; i++) {
      const theta = (i / rings) * Math.PI - Math.PI / 2;
      
      for (let j = 0; j <= segments; j++) {
        const phi = (j / segments) * Math.PI * 2;
        
        const cosTheta = Math.cos(theta);
        const r = theta > 0 
          ? r0 * Math.pow(2 / (1 + cosTheta), alpha)
          : r0 * Math.pow(2 / (1 + cosTheta), alpha) * (1 + theta * 0.3);

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

  // Magnetotail geometry - elongated parabolic sheet
  const magnetotailGeometry = useMemo(() => {
    return createMagnetotailGeometry(35, 4, 32, 24);
  }, []);

  const magnetotailMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPosition;
        varying float vDistance;
        
        void main() {
          vPosition = position;
          vDistance = -position.x; // Distance along tail
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vPosition;
        varying float vDistance;
        
        void main() {
          // Fade out toward tail end
          float distanceFade = 1.0 - smoothstep(5.0, 35.0, vDistance);
          
          // Animated plasma flow toward tail
          float flow = sin(vDistance * 0.3 + uTime * 1.5) * 0.3 + 0.7;
          
          // Color gradient: cyan near Earth, darker blue toward tail
          vec3 nearColor = vec3(0.0, 0.8, 1.0);
          vec3 farColor = vec3(0.0, 0.2, 0.5);
          vec3 color = mix(nearColor, farColor, smoothstep(0.0, 30.0, vDistance));
          
          float alpha = distanceFade * flow * 0.15;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  // Current sheet - thin glowing plane in the center of the tail
  const currentSheetGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(35, 8, 32, 8);
    // Offset vertices to start at x = -4
    const positions = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = positions[i] - 21.5; // Center at -21.5 so it spans -4 to -39
    }
    geometry.attributes.position.needsUpdate = true;
    return geometry;
  }, []);

  const currentSheetMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          vUv = uv;
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          // Fade from center outward (Y direction)
          float centerFade = 1.0 - abs(vUv.y - 0.5) * 2.0;
          centerFade = pow(centerFade, 3.0);
          
          // Distance fade along tail
          float distanceFade = 1.0 - smoothstep(-10.0, -39.0, vPosition.x);
          
          // Animated reconnection pulses
          float pulse = sin(-vPosition.x * 0.2 + uTime * 2.0) * 0.5 + 0.5;
          
          // Hot orange-yellow color for current sheet
          vec3 color = vec3(1.0, 0.6, 0.1);
          
          float alpha = centerFade * distanceFade * (0.2 + pulse * 0.3);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  // Dipole field lines with open/closed topology
  const fieldLines = useMemo(() => {
    const lines: { points: THREE.Vector3[]; isOpen: boolean }[] = [];
    
    // Closed field lines on dayside (12 lines)
    for (let i = 0; i < 12; i++) {
      const phi = (i / 12) * Math.PI * 2;
      const L = 2.5 + Math.random() * 1.5;
      const points = generateDipoleFieldLine(L, phi, 40, false, 0);
      lines.push({ points, isOpen: false });
    }
    
    // Open field lines connecting to tail (8 lines on nightside)
    for (let i = 0; i < 8; i++) {
      const phi = Math.PI + (i / 8 - 0.5) * Math.PI * 0.6; // Nightside only
      const L = 4 + Math.random() * 2;
      const points = generateDipoleFieldLine(L, phi, 40, true, 15);
      lines.push({ points, isOpen: true });
    }

    return lines;
  }, []);

  useFrame((state) => {
    if (magnetopauseMaterial) {
      magnetopauseMaterial.uniforms.time.value = state.clock.elapsedTime;
      magnetopauseMaterial.uniforms.compression.value = compression;
      magnetopauseMaterial.uniforms.reconnection.value = reconnectionStrength;
    }
    if (magnetotailMaterial) {
      magnetotailMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (currentSheetMaterial) {
      currentSheetMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (fieldLinesRef.current) {
      fieldLinesRef.current.rotation.y += 0.0005;
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

      {/* Magnetotail - elongated parabolic cavity */}
      <mesh
        geometry={magnetotailGeometry}
        material={magnetotailMaterial}
      />

      {/* Current sheet in magnetotail */}
      <mesh
        geometry={currentSheetGeometry}
        material={currentSheetMaterial}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* Dipole field lines */}
      <group ref={fieldLinesRef}>
        {fieldLines.map((line, index) => (
          <line key={index}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={line.points.length}
                array={new Float32Array(line.points.flatMap(p => [p.x, p.y, p.z]))}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color={line.isOpen ? "#ff6644" : "#00aaff"}
              transparent
              opacity={line.isOpen ? 0.4 : 0.3}
              linewidth={1}
            />
          </line>
        ))}
      </group>
    </group>
  );
};
