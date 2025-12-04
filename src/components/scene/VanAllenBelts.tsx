import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VanAllenBeltsProps {
  visible: boolean;
  intensity: number;
}

const BeltRing = ({ 
  innerRadius, 
  outerRadius, 
  color, 
  intensity,
  rotationSpeed,
  particleCount = 2000,
}: {
  innerRadius: number;
  outerRadius: number;
  color: string;
  intensity: number;
  rotationSpeed: number;
  particleCount?: number;
}) => {
  const groupRef = useRef<THREE.Group>(null);

  const { positions, colors, sizes } = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const baseColor = new THREE.Color(color);

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.4; // Constrain to equatorial region
      const r = innerRadius + Math.random() * (outerRadius - innerRadius);
      
      positions[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
      positions[i * 3 + 1] = Math.sin(phi) * r * 0.3; // Flatten vertically
      positions[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;

      // Color variation with distance
      const distanceFactor = (r - innerRadius) / (outerRadius - innerRadius);
      const colorVariation = 0.6 + Math.random() * 0.4;
      colors[i * 3] = baseColor.r * colorVariation;
      colors[i * 3 + 1] = baseColor.g * colorVariation * (1 - distanceFactor * 0.3);
      colors[i * 3 + 2] = baseColor.b * colorVariation;

      sizes[i] = 0.008 + Math.random() * 0.015;
    }

    return { positions, colors, sizes };
  }, [innerRadius, outerRadius, color, particleCount]);

  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        intensity: { value: intensity },
        time: { value: 0 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 customColor;
        varying vec3 vColor;
        varying float vIntensity;
        uniform float intensity;
        uniform float time;
        
        void main() {
          vColor = customColor;
          vIntensity = intensity;
          
          vec3 pos = position;
          float angle = atan(pos.z, pos.x);
          float pulse = sin(angle * 3.0 + time * 1.5) * 0.5 + 0.5;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * 150.0 * (0.7 + pulse * 0.3) * intensity * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vIntensity;
        
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          
          // Soft falloff
          float alpha = smoothstep(0.5, 0.1, dist) * vIntensity * 0.4;
          vec3 glow = vColor * (1.0 + smoothstep(0.4, 0.0, dist) * 0.3);
          
          gl_FragColor = vec4(glow, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [intensity]);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += rotationSpeed;
    }
    if (shaderMaterial) {
      shaderMaterial.uniforms.time.value = state.clock.elapsedTime;
      shaderMaterial.uniforms.intensity.value = intensity;
    }
  });

  return (
    <group ref={groupRef}>
      <points material={shaderMaterial}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={positions.length / 3}
            array={positions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-customColor"
            count={colors.length / 3}
            array={colors}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-size"
            count={sizes.length}
            array={sizes}
            itemSize={1}
          />
        </bufferGeometry>
      </points>
    </group>
  );
};

// Glow ring for soft volumetric effect
const GlowRing = ({
  radius,
  color,
  opacity,
}: {
  radius: number;
  color: string;
  opacity: number;
}) => {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        opacity: { value: opacity },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 1.0, 0.0)), 2.0);
          gl_FragColor = vec4(color, intensity * opacity * 0.3);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [color, opacity]);

  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} material={material}>
      <ringGeometry args={[radius * 0.8, radius * 1.2, 64]} />
    </mesh>
  );
};

export const VanAllenBelts = ({ visible, intensity }: VanAllenBeltsProps) => {
  if (!visible) return null;

  const adjustedIntensity = 0.2 + intensity * 0.5;

  return (
    <group>
      {/* Inner Belt glow - subtle */}
      <GlowRing radius={1.8} color="#ff8c00" opacity={adjustedIntensity * 0.25} />
      
      {/* Inner Belt particles - reduced count and intensity */}
      <BeltRing
        innerRadius={1.4}
        outerRadius={2.0}
        color="#ff9500"
        intensity={adjustedIntensity * 0.6}
        rotationSpeed={0.0008}
        particleCount={800}
      />
      
      {/* Outer Belt glow - very subtle */}
      <GlowRing radius={3.5} color="#ff5500" opacity={adjustedIntensity * 0.15} />
      
      {/* Outer Belt particles */}
      <BeltRing
        innerRadius={3.0}
        outerRadius={4.2}
        color="#ff6600"
        intensity={adjustedIntensity * 0.4}
        rotationSpeed={0.0004}
        particleCount={1200}
      />
    </group>
  );
};
