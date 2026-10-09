import * as THREE from "three";

/**
 * The "model sphere": a sphere of glowing particles with an atmosphere halo and
 * one orbit per pole of the assembled model.
 *
 * A pole λ = σ + jω is drawn as a body on its own ring:
 *   ring radius  ∝ |λ| = ω₀ (natural frequency),
 *   ring tilt    ∝ 1 − ζ (an oscillatory pole tilts its orbit),
 *   orbit speed  ∝ |ω| (direction by the sign of ω),
 *   colour       red when σ > 0 (unstable), cool white otherwise.
 * Everything eases toward new poles, so live parameter changes glide.
 */

export interface Pole {
  real: number;
  imag: number;
}

interface Orbit {
  pivot: THREE.Group;
  ring: THREE.Line;
  body: THREE.Sprite;
  trail: THREE.Line;
  radius: number;
  tilt: number;
  speed: number;
  phase: number;
  color: THREE.Color;
  target: { radius: number; tilt: number; speed: number };
  unstable: boolean;
  active: boolean;
  history: THREE.Vector3[];
}

const R = 1.4;
const PARTICLES = 6000;
const TRAIL = 40;
const COOL = new THREE.Color("#a9c8ff");
const RED = new THREE.Color("#ff4b3e");
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

function radialTexture(stops: Array<[number, string]>, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class ParticleSphere {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  private readonly world = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly halo: THREE.Sprite;
  private readonly orbits: Orbit[] = [];
  private readonly dotTexture = radialTexture([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,.75)"], [1, "rgba(255,255,255,0)"]], 64);
  /** 0 → particles scattered in a cloud, 1 → assembled into the sphere. */
  assembly = 1;
  /** 0 → orbits hidden, 1 → traced in full. */
  orbitsIn = 1;
  haloOpacity = 1;
  animate = true;
  cameraDistance = 6.6;
  cameraHeight = 0.6;
  private pulse = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.world.rotation.x = 0.38;
    this.scene.add(this.world);

    const positions = new Float32Array(PARTICLES * 3);
    const start = new Float32Array(PARTICLES * 3);
    const delay = new Float32Array(PARTICLES);
    const seed = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i += 1) {
      // Fibonacci lattice: evenly spread points on the sphere.
      const y = 1 - (i / (PARTICLES - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = i * Math.PI * (3 - Math.sqrt(5));
      positions.set([Math.cos(theta) * r * R, y * R, Math.sin(theta) * r * R], i * 3);
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 7;
      const q = Math.sqrt(1 - u * u);
      start.set([q * Math.cos(phi) * radius, u * radius * 0.6, q * Math.sin(phi) * radius], i * 3);
      delay[i] = Math.random() * 0.45;
      seed[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("start", new THREE.BufferAttribute(start, 3));
    geometry.setAttribute("delay", new THREE.BufferAttribute(delay, 1));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 1 },
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uScale: { value: 1 },
        uPR: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute vec3 start; attribute float delay; attribute float seed;
        uniform float uProgress, uTime, uPulse, uScale, uPR;
        varying float vA; varying float vRim;
        float easeOut(float x){ x = clamp(x, 0.0, 1.0); return 1.0 - pow(1.0 - x, 3.0); }
        void main(){
          float p = easeOut((uProgress * 1.6 - delay) / 0.55);
          float breathe = 1.0 + 0.018 * sin(uTime * 1.3 + seed * 6.2831) + 0.05 * uPulse * sin(seed * 12.0 + uTime * 6.0);
          vec3 swirl = vec3(cos(uTime * 0.2 + seed * 6.28), 0.0, sin(uTime * 0.2 + seed * 6.28)) * 0.6 * (1.0 - p);
          vec4 mv = modelViewMatrix * vec4(mix(start + swirl, position * breathe, p), 1.0);
          gl_Position = projectionMatrix * mv;
          vec3 n = normalize(normalMatrix * normalize(position));
          float facing = dot(n, normalize(-mv.xyz));
          vRim = pow(1.0 - abs(facing), 2.2);
          vA = (0.26 + 0.7 * vRim) * (facing > 0.0 ? 1.0 : 0.22) * (0.45 + 0.55 * p);
          gl_PointSize = (1.6 + 2.2 * seed) * uScale * uPR * (6.0 / -mv.z);
        }`,
      fragmentShader: `
        varying float vA; varying float vRim;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          vec3 c = mix(vec3(0.62, 0.76, 1.0), vec3(0.95, 0.97, 1.0), vRim);
          gl_FragColor = vec4(c, smoothstep(0.5, 0.0, d) * vA);
        }`,
    });
    this.world.add(new THREE.Points(geometry, this.material));

    // Atmosphere: a halo peaking just outside the edge and fading into space.
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture([
        [0, "rgba(60,110,230,0)"], [0.52, "rgba(60,110,230,.05)"], [0.6, "rgba(110,160,255,.26)"],
        [0.66, "rgba(70,120,240,.16)"], [0.82, "rgba(40,80,200,.04)"], [1, "rgba(30,60,180,0)"],
      ], 512),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.halo.scale.setScalar((R * 2) / 0.6);
    this.scene.add(this.halo);
  }

  private makeOrbit(): Orbit {
    const ringPoints: THREE.Vector3[] = [];
    for (let k = 0; k <= 160; k += 1) {
      const a = (k / 160) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color: COOL, opacity: 0.32, ...additive }));
    const body = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTexture, color: COOL, ...additive }));
    body.scale.setScalar(0.22);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, ...additive }));
    const pivot = new THREE.Group();
    pivot.add(ring, body, trail);
    this.world.add(pivot);
    const orbit: Orbit = {
      pivot, ring, body, trail,
      radius: R * 1.5, tilt: 0, speed: 0.3, phase: Math.random() * Math.PI * 2,
      color: COOL.clone(), target: { radius: R * 1.5, tilt: 0, speed: 0.3 },
      unstable: false, active: false, history: [],
    };
    this.orbits.push(orbit);
    return orbit;
  }

  /** Show the poles of a model; at most eight orbits are drawn. */
  setPoles(poles: Pole[]): void {
    const shown = poles.slice(0, 8);
    while (this.orbits.length < shown.length) this.makeOrbit();
    const scale = Math.max(1, ...shown.map((pole) => Math.hypot(pole.real, pole.imag)));
    this.orbits.forEach((orbit, index) => {
      const pole = shown[index];
      orbit.active = Boolean(pole);
      orbit.pivot.visible = orbit.active;
      if (!pole) return;
      const magnitude = Math.hypot(pole.real, pole.imag);
      const zeta = magnitude > 1e-9 ? clamp(-pole.real / magnitude, -1, 1) : 1;
      orbit.target.radius = R * (1.22 + 0.55 * clamp(magnitude / scale));
      orbit.target.tilt = (1 - Math.abs(zeta)) * 1.1 * (index % 2 ? -1 : 1) + (index % 2 ? 0.25 : -0.15);
      orbit.target.speed = (0.25 + Math.min(4, Math.abs(pole.imag)) * 0.55) * (pole.imag < 0 ? -1 : 1);
      orbit.unstable = pole.real > 1e-9;
    });
  }

  /** A short ripple through the particles, e.g. when a run starts. */
  kick(): void {
    this.pulse = 1;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(now = performance.now()): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const time = this.animate ? now / 1000 : 0;
    this.material.uniforms.uProgress.value = this.assembly;
    this.material.uniforms.uTime.value = time;
    this.pulse *= 0.965;
    this.material.uniforms.uPulse.value = this.pulse;
    (this.halo.material as THREE.SpriteMaterial).opacity = this.haloOpacity;

    this.orbits.forEach((orbit, index) => {
      if (!orbit.active) return;
      orbit.radius = lerp(orbit.radius, orbit.target.radius, 0.08);
      orbit.tilt = lerp(orbit.tilt, orbit.target.tilt, 0.08);
      orbit.speed = lerp(orbit.speed, orbit.target.speed, 0.1);
      orbit.color.lerp(orbit.unstable ? RED : COOL, 0.12);
      orbit.pivot.rotation.set(orbit.tilt, index * 0.9, orbit.tilt * 0.4);
      orbit.ring.scale.setScalar(orbit.radius);
      orbit.ring.geometry.setDrawRange(0, Math.floor(161 * easeOut(this.orbitsIn - index * 0.15)));
      const ringMaterial = orbit.ring.material as THREE.LineBasicMaterial;
      ringMaterial.color.copy(orbit.color);
      ringMaterial.opacity = 0.28 + (orbit.unstable ? 0.25 : 0);
      if (this.animate) orbit.phase += orbit.speed * dt;
      const angle = orbit.phase + (index % 2 ? Math.PI : 0);
      const position = new THREE.Vector3(Math.cos(angle) * orbit.radius, 0, Math.sin(angle) * orbit.radius);
      const bodyMaterial = orbit.body.material as THREE.SpriteMaterial;
      orbit.body.position.copy(position);
      bodyMaterial.color.copy(orbit.color);
      bodyMaterial.opacity = easeOut(this.orbitsIn * 1.4 - 0.4);
      orbit.body.scale.setScalar(0.2 + (orbit.unstable ? 0.06 * Math.sin(time * 6) : 0.02 * Math.sin(time * 2 + index)));
      orbit.history.unshift(position);
      if (orbit.history.length > TRAIL) orbit.history.pop();
      const trailPositions = orbit.trail.geometry.attributes.position as THREE.BufferAttribute;
      const trailColors = orbit.trail.geometry.attributes.color as THREE.BufferAttribute;
      for (let k = 0; k < TRAIL; k += 1) {
        const point = orbit.history[Math.min(k, orbit.history.length - 1)];
        trailPositions.setXYZ(k, point.x, point.y, point.z);
        const fade = (1 - k / TRAIL) * 0.9 * bodyMaterial.opacity;
        trailColors.setXYZ(k, orbit.color.r * fade, orbit.color.g * fade, orbit.color.b * fade);
      }
      trailPositions.needsUpdate = true;
      trailColors.needsUpdate = true;
    });

    if (this.animate) this.world.rotation.y += dt * 0.12;
    this.camera.position.set(0, this.cameraHeight, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
    this.dotTexture.dispose();
    this.renderer.dispose();
  }
}
