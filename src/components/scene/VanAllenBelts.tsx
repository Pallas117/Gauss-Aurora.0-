import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VanAllenBeltsProps {
  visible: boolean;
  intensity: number;
}

/**
 * Van Allen Belts using SDF Raymarching
 * 
 * Implements the shader spec with:
 * - Toroidal SDF for inner/outer belts
 * - Limited raymarching (max 24 steps)
 * - Noise-based pulsing modulated by particle flux
 * - Color gradient: green → yellow → red
 */
export const VanAllenBelts = ({ visible, intensity }: VanAllenBeltsProps) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: intensity },
        uInnerBeltRadius: { value: 1.8 },
        uOuterBeltRadius: { value: 3.5 },
        uCameraPosition: { value: new THREE.Vector3() },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vLocalPosition;
        
        void main() {
          vLocalPosition = position;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uInnerBeltRadius;
        uniform float uOuterBeltRadius;
        uniform vec3 uCameraPosition;
        
        varying vec3 vWorldPosition;
        varying vec3 vLocalPosition;
        
        // Toroidal SDF - flattened for belt shape
        float sdBelt(vec3 p, float majorRadius, float minorRadiusXZ, float minorRadiusY) {
          vec2 q = vec2(length(p.xz) - majorRadius, p.y);
          return length(vec2(q.x / minorRadiusXZ, q.y / minorRadiusY)) - 1.0;
        }
        
        // Simple 3D noise for variation
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        
        float noise3D(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          
          return mix(
            mix(
              mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x),
              f.y
            ),
            mix(
              mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x),
              f.y
            ),
            f.z
          );
        }
        
        // FBM noise for more organic look
        float fbm(vec3 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 3; i++) {
            value += amplitude * noise3D(p);
            p *= 2.0;
            amplitude *= 0.5;
          }
          return value;
        }
        
        void main() {
          vec3 rayOrigin = uCameraPosition;
          vec3 rayDir = normalize(vWorldPosition - uCameraPosition);
          
          float totalDensity = 0.0;
          vec3 accumulatedColor = vec3(0.0);
          
          // Raymarch parameters - max 24 steps as per spec
          float stepSize = 0.12;
          vec3 currentPos = vWorldPosition;
          
          // Color palette based on intensity (green → yellow → red)
          vec3 lowColor = vec3(0.15, 0.65, 0.25);   // Green
          vec3 midColor = vec3(0.95, 0.75, 0.15);   // Yellow  
          vec3 highColor = vec3(0.95, 0.25, 0.1);   // Red
          
          vec3 beltColor = mix(
            lowColor,
            mix(midColor, highColor, smoothstep(0.5, 1.0, uIntensity)),
            smoothstep(0.0, 0.5, uIntensity)
          );
          
          for (int i = 0; i < 24; i++) {
            // Inner belt SDF (proton belt - ~1.5-2.5 Earth radii)
            float innerDist = sdBelt(currentPos, uInnerBeltRadius, 0.45, 0.15);
            float innerDensity = exp(-innerDist * innerDist * 12.0);
            
            // Outer belt SDF (electron belt - ~3-5 Earth radii)  
            float outerDist = sdBelt(currentPos, uOuterBeltRadius, 0.9, 0.25);
            float outerDensity = exp(-outerDist * outerDist * 6.0);
            
            // Add noise modulation for organic look
            float noiseScale = 1.5;
            vec3 noisePos = currentPos * noiseScale + vec3(uTime * 0.08, 0.0, uTime * 0.05);
            float noiseVal = fbm(noisePos) * 0.6 + 0.4;
            
            // Pulsing effect - subtle breathing
            float angle = atan(currentPos.z, currentPos.x);
            float pulseFactor = 0.85 + 0.15 * sin(uTime * 1.5 + angle * 2.0 + length(currentPos.xz) * 0.8);
            
            // Combine densities with modulation
            float combinedDensity = (innerDensity * 0.7 + outerDensity * 0.5) * noiseVal * pulseFactor * uIntensity;
            
            // Slightly different colors for inner vs outer belt
            vec3 innerColor = beltColor;
            vec3 outerColor = beltColor * vec3(0.9, 0.95, 1.1); // Slightly bluer outer belt
            
            vec3 sampleColor = mix(outerColor, innerColor, innerDensity / max(innerDensity + outerDensity, 0.001));
            
            accumulatedColor += sampleColor * combinedDensity * stepSize;
            totalDensity += combinedDensity * stepSize;
            
            currentPos += rayDir * stepSize;
            
            // Early exit if saturated (performance optimization)
            if (totalDensity > 0.85) break;
          }
          
          // Apply glow effect
          accumulatedColor *= 1.2;
          
          // Clamp alpha for subtlety
          float finalAlpha = min(totalDensity, 0.45) * uIntensity;
          
          gl_FragColor = vec4(accumulatedColor, finalAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  useFrame((state) => {
    if (shaderMaterial) {
      shaderMaterial.uniforms.uTime.value = state.clock.elapsedTime;
      shaderMaterial.uniforms.uIntensity.value = 0.3 + intensity * 0.7;
      shaderMaterial.uniforms.uCameraPosition.value.copy(state.camera.position);
    }
  });

  if (!visible) return null;

  return (
    <mesh ref={meshRef} material={shaderMaterial}>
      {/* Bounding sphere for raymarching - encompasses both belts */}
      <sphereGeometry args={[5.5, 64, 32]} />
    </mesh>
  );
};
