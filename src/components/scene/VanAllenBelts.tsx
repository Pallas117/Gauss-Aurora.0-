import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VanAllenBeltsProps {
  visible: boolean;
  intensity: number;
}

/**
 * Van Allen Belts - NASA SVS Style
 * 
 * Uses parametric torus geometry with gradient shaders
 * for clear scientific visualization and optimal performance.
 * Target: <1ms render time per frame
 */
export const VanAllenBelts = ({ visible, intensity }: VanAllenBeltsProps) => {
  const innerBeltRef = useRef<THREE.Mesh>(null);
  const outerBeltRef = useRef<THREE.Mesh>(null);

  // Inner belt material (proton belt ~1.5-2.5 Earth radii)
  const innerBeltMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vRadialDist;
        
        void main() {
          vUv = uv;
          // Calculate radial distance from torus tube center
          vRadialDist = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying float vRadialDist;
        
        void main() {
          // NASA SVS color gradient: green → yellow → red
          vec3 lowColor = vec3(0.0, 1.0, 0.53);    // #00FF88 bright green
          vec3 midColor = vec3(1.0, 0.93, 0.0);    // #FFEE00 yellow
          vec3 highColor = vec3(1.0, 0.27, 0.0);   // #FF4400 orange-red
          
          // Color based on intensity
          vec3 color = mix(
            lowColor,
            mix(midColor, highColor, smoothstep(0.5, 1.0, uIntensity)),
            smoothstep(0.0, 0.5, uIntensity)
          );
          
          // Sharp band falloff from tube center
          float dist = abs(vRadialDist - 0.5) * 2.0;
          float band = 1.0 - smoothstep(0.0, 0.8, dist);
          band = pow(band, 0.7);
          
          // Subtle flow animation
          float flow = sin(vUv.x * 20.0 - uTime * 2.0) * 0.1 + 0.9;
          
          // Pulsing based on intensity
          float pulse = 0.9 + 0.1 * sin(uTime * 1.5);
          
          float alpha = band * flow * pulse * (0.6 + uIntensity * 0.4);
          
          gl_FragColor = vec4(color * (0.8 + band * 0.4), alpha * 0.75);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  // Outer belt material (electron belt ~3-5 Earth radii)
  const outerBeltMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vRadialDist;
        
        void main() {
          vUv = uv;
          vRadialDist = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying float vRadialDist;
        
        void main() {
          // Outer belt: more blue-shifted colors
          vec3 lowColor = vec3(0.0, 0.8, 0.9);     // Cyan-green
          vec3 midColor = vec3(0.2, 1.0, 0.6);     // Bright green
          vec3 highColor = vec3(1.0, 0.8, 0.0);    // Golden yellow
          
          vec3 color = mix(
            lowColor,
            mix(midColor, highColor, smoothstep(0.5, 1.0, uIntensity)),
            smoothstep(0.0, 0.5, uIntensity)
          );
          
          // Sharp band with softer edges for larger belt
          float dist = abs(vRadialDist - 0.5) * 2.0;
          float band = 1.0 - smoothstep(0.0, 0.85, dist);
          band = pow(band, 0.6);
          
          // Different flow speed for outer belt
          float flow = sin(vUv.x * 15.0 - uTime * 1.5) * 0.15 + 0.85;
          
          float pulse = 0.85 + 0.15 * sin(uTime * 1.2 + 1.0);
          
          float alpha = band * flow * pulse * (0.5 + uIntensity * 0.5);
          
          gl_FragColor = vec4(color * (0.7 + band * 0.5), alpha * 0.65);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const clampedIntensity = 0.3 + intensity * 0.7;
    
    if (innerBeltMaterial) {
      innerBeltMaterial.uniforms.uTime.value = time;
      innerBeltMaterial.uniforms.uIntensity.value = clampedIntensity;
    }
    if (outerBeltMaterial) {
      outerBeltMaterial.uniforms.uTime.value = time;
      outerBeltMaterial.uniforms.uIntensity.value = clampedIntensity;
    }
  });

  if (!visible) return null;

  return (
    <group>
      {/* Inner Belt - Proton belt */}
      <mesh 
        ref={innerBeltRef} 
        material={innerBeltMaterial}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[1.8, 0.35, 24, 64]} />
      </mesh>
      
      {/* Outer Belt - Electron belt */}
      <mesh 
        ref={outerBeltRef} 
        material={outerBeltMaterial}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[3.5, 0.75, 24, 64]} />
      </mesh>
      
      {/* Slot region glow - subtle indicator of the gap */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.6, 0.15, 12, 48]} />
        <meshBasicMaterial 
          color="#002244" 
          transparent 
          opacity={0.15} 
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
