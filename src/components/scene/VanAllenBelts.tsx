import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VanAllenBeltsProps {
  visible: boolean;
  intensity: number;
  compression?: number;
  showSAA?: boolean;
}

/**
 * Creates L-shell geometry following dipole magnetic field equation:
 * r = L * cos²(λ) where λ is magnetic latitude
 * 
 * This creates realistic crescent-shaped radiation belt cross-sections
 * that bulge at the equator and pinch toward the poles.
 */
function createLShellGeometry(
  innerL: number,
  outerL: number,
  latitudeRange: number,
  longitudeSegments: number,
  latitudeSegments: number,
  compression: number
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Generate vertices following L-shell parametric equations
  for (let i = 0; i <= latitudeSegments; i++) {
    // Magnetic latitude from -latitudeRange to +latitudeRange
    const latFraction = i / latitudeSegments;
    const lambda = (latFraction - 0.5) * 2 * latitudeRange * (Math.PI / 180);
    const cosLambda = Math.cos(lambda);
    const cos2Lambda = cosLambda * cosLambda;

    for (let j = 0; j <= longitudeSegments; j++) {
      const lonFraction = j / longitudeSegments;
      const phi = lonFraction * Math.PI * 2;

      // Interpolate between inner and outer L-shells for belt thickness
      // Use middle of the belt for the main surface
      const L = (innerL + outerL) / 2;
      const thickness = (outerL - innerL) / 2;

      // Dipole field: r = L * cos²(λ)
      let r = L * cos2Lambda;

      // Apply day/night compression asymmetry
      // Sunward side (positive X) is compressed, nightside is stretched
      const sunwardFactor = Math.cos(phi);
      const compressionEffect = 1 - (compression - 1) * 0.15 * sunwardFactor;
      r *= compressionEffect;

      // Convert to Cartesian coordinates
      // In dipole coordinates: x = r*cos(λ)*cos(φ), y = r*sin(λ), z = r*cos(λ)*sin(φ)
      const x = r * cosLambda * Math.cos(phi);
      const y = r * Math.sin(lambda);
      const z = r * cosLambda * Math.sin(phi);

      vertices.push(x, y, z);
      uvs.push(lonFraction, latFraction);
    }
  }

  // Generate indices for triangle strip
  for (let i = 0; i < latitudeSegments; i++) {
    for (let j = 0; j < longitudeSegments; j++) {
      const current = i * (longitudeSegments + 1) + j;
      const next = current + longitudeSegments + 1;

      indices.push(current, next, current + 1);
      indices.push(current + 1, next, next + 1);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Van Allen Belts - NASA SVS Style with L-Shell Geometry
 * 
 * Uses parametric L-shell geometry following magnetic dipole field equations
 * for scientifically accurate visualization of radiation belt structure.
 */
/**
 * Creates South Atlantic Anomaly (SAA) geometry
 * The SAA is where the inner belt dips closest to Earth due to the offset dipole
 * Centered around 30°S, 45°W (in geographic coordinates)
 */
function createSAAGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  
  const segments = 32;
  const rings = 16;
  
  // SAA center in spherical coords (converted from 30°S, 45°W)
  // In our coordinate system: latitude -30°, longitude -45°
  const centerLat = -30 * Math.PI / 180;
  const centerLon = -45 * Math.PI / 180;
  
  // SAA extends roughly 60° in longitude and 40° in latitude
  const lonSpread = 30 * Math.PI / 180;
  const latSpread = 20 * Math.PI / 180;
  
  for (let i = 0; i <= rings; i++) {
    const ringFraction = i / rings;
    // Use gaussian-like falloff for the anomaly region
    const ringAngle = ringFraction * Math.PI * 2;
    
    for (let j = 0; j <= segments; j++) {
      const segFraction = j / segments;
      const angle = segFraction * Math.PI * 2;
      
      // Create elliptical region
      const offsetLat = Math.sin(angle) * latSpread * (1 - ringFraction * 0.7);
      const offsetLon = Math.cos(angle) * lonSpread * (1 - ringFraction * 0.7);
      
      const lat = centerLat + offsetLat;
      const lon = centerLon + offsetLon;
      
      // The SAA dips down to about L=1.1 at its lowest
      // Normal inner belt is at L=1.5, so we show the "dip"
      const dipDepth = 0.4 * (1 - ringFraction) * Math.exp(-ringFraction * 2);
      const radius = 1.15 + dipDepth * 0.3 + ringFraction * 0.8;
      
      const x = radius * Math.cos(lat) * Math.cos(lon);
      const y = radius * Math.sin(lat);
      const z = radius * Math.cos(lat) * Math.sin(lon);
      
      vertices.push(x, y, z);
      uvs.push(segFraction, ringFraction);
    }
  }
  
  // Generate indices
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const current = i * (segments + 1) + j;
      const next = current + segments + 1;
      
      indices.push(current, next, current + 1);
      indices.push(current + 1, next, next + 1);
    }
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
}

export const VanAllenBelts = ({ visible, intensity, compression = 1, showSAA = false }: VanAllenBeltsProps) => {
  const innerBeltRef = useRef<THREE.Mesh>(null);
  const outerBeltRef = useRef<THREE.Mesh>(null);
  const saaRef = useRef<THREE.Mesh>(null);

  // Inner belt geometry (proton belt L=1.5 to 2.5)
  const innerBeltGeometry = useMemo(() => {
    return createLShellGeometry(1.4, 2.4, 50, 64, 32, compression);
  }, [compression]);

  // Outer belt geometry (electron belt L=3.5 to 5.5)
  const outerBeltGeometry = useMemo(() => {
    return createLShellGeometry(3.2, 5.0, 60, 64, 32, compression);
  }, [compression]);
  
  // SAA geometry
  const saaGeometry = useMemo(() => createSAAGeometry(), []);
  
  // SAA material - warning colors to indicate hazardous zone
  const saaMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: intensity },
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
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          // Warning colors: orange to red
          vec3 coreColor = vec3(1.0, 0.2, 0.1);   // Deep red
          vec3 edgeColor = vec3(1.0, 0.6, 0.0);   // Orange
          
          // Radial falloff from center
          float dist = vUv.y;
          float falloff = 1.0 - smoothstep(0.0, 1.0, dist);
          falloff = pow(falloff, 1.5);
          
          vec3 color = mix(edgeColor, coreColor, falloff);
          
          // Pulsing warning effect
          float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
          
          // Hazard pattern - concentric rings
          float rings = sin(dist * 15.0 - uTime * 2.0) * 0.2 + 0.8;
          
          float alpha = falloff * pulse * rings * (0.6 + uIntensity * 0.4);
          
          gl_FragColor = vec4(color * (0.8 + falloff * 0.4), alpha * 0.8);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  // Inner belt material (proton belt)
  const innerBeltMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        varying float vRadialDist;
        
        void main() {
          vUv = uv;
          vPosition = position;
          // Distance from Earth center for intensity falloff
          vRadialDist = length(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vPosition;
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
          
          // Latitude-based intensity (stronger at equator)
          float latitudeFactor = abs(vUv.y - 0.5) * 2.0;
          float equatorBand = 1.0 - smoothstep(0.0, 0.8, latitudeFactor);
          equatorBand = pow(equatorBand, 0.6);
          
          // Radial falloff within the belt
          float normalizedR = (vRadialDist - 1.4) / (2.4 - 1.4);
          float radialBand = sin(normalizedR * 3.14159);
          radialBand = pow(radialBand, 0.5);
          
          // Subtle flow animation along longitude
          float flow = sin(vUv.x * 20.0 - uTime * 2.0) * 0.1 + 0.9;
          
          // Pulsing based on intensity
          float pulse = 0.9 + 0.1 * sin(uTime * 1.5);
          
          float alpha = equatorBand * radialBand * flow * pulse * (0.5 + uIntensity * 0.5);
          
          gl_FragColor = vec4(color * (0.8 + equatorBand * 0.4), alpha * 0.7);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  // Outer belt material (electron belt)
  const outerBeltMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        varying float vRadialDist;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vRadialDist = length(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying float vRadialDist;
        
        void main() {
          // Outer belt: more blue-shifted colors for electron population
          vec3 lowColor = vec3(0.0, 0.8, 0.9);     // Cyan
          vec3 midColor = vec3(0.2, 1.0, 0.6);     // Bright green
          vec3 highColor = vec3(1.0, 0.8, 0.0);    // Golden yellow
          
          vec3 color = mix(
            lowColor,
            mix(midColor, highColor, smoothstep(0.5, 1.0, uIntensity)),
            smoothstep(0.0, 0.5, uIntensity)
          );
          
          // Latitude-based intensity with wider spread for outer belt
          float latitudeFactor = abs(vUv.y - 0.5) * 2.0;
          float equatorBand = 1.0 - smoothstep(0.0, 0.85, latitudeFactor);
          equatorBand = pow(equatorBand, 0.5);
          
          // Radial distribution - outer belt is more diffuse
          float normalizedR = (vRadialDist - 3.2) / (5.0 - 3.2);
          float radialBand = sin(normalizedR * 3.14159);
          radialBand = pow(radialBand, 0.4);
          
          // Different flow speed for outer belt
          float flow = sin(vUv.x * 15.0 - uTime * 1.5) * 0.15 + 0.85;
          
          float pulse = 0.85 + 0.15 * sin(uTime * 1.2 + 1.0);
          
          float alpha = equatorBand * radialBand * flow * pulse * (0.4 + uIntensity * 0.6);
          
          gl_FragColor = vec4(color * (0.7 + equatorBand * 0.5), alpha * 0.6);
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
    if (saaMaterial) {
      saaMaterial.uniforms.uTime.value = time;
      saaMaterial.uniforms.uIntensity.value = clampedIntensity;
    }
  });

  if (!visible) return null;

  return (
    <group>
      {/* Inner Belt - Proton belt following L-shell geometry */}
      <mesh 
        ref={innerBeltRef} 
        geometry={innerBeltGeometry}
        material={innerBeltMaterial}
      />
      
      {/* Outer Belt - Electron belt following L-shell geometry */}
      <mesh 
        ref={outerBeltRef} 
        geometry={outerBeltGeometry}
        material={outerBeltMaterial}
      />
      
      {/* Slot region glow - subtle indicator of the gap between belts */}
      <mesh>
        <torusGeometry args={[2.8, 0.12, 16, 64]} />
        <meshBasicMaterial 
          color="#001133" 
          transparent 
          opacity={0.1} 
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {/* South Atlantic Anomaly - where inner belt dips closest to Earth */}
      {showSAA && (
        <mesh
          ref={saaRef}
          geometry={saaGeometry}
          material={saaMaterial}
        />
      )}
    </group>
  );
};
