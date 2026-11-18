/**
 * Floor berries: the pixel-art berry icons resting on the sand with a shiny-style glow pulse and
 * a soft cyan halo, so a berry reads from a distance like a shiny Pokémon does. Render-only:
 * positions come straight from session.berries.floor (at most a handful per heart).
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { BERRIES, BERRY_IDS, BERRY_RULES, type BerryId } from '@/data/berries';

const POOL = 8;

const textures = new Map<BerryId, THREE.Texture>();
function textureOf(id: BerryId): THREE.Texture {
  let t = textures.get(id);
  if (!t) {
    t = new THREE.TextureLoader().load(BERRIES[id].icon);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(id, t);
  }
  return t;
}

export const BILLBOARD_VERT = /* glsl */ `
  uniform float uTime, uPhase, uSize;
  varying vec2 vUv;
  void main(){
    vUv = uv;
    vec4 c = modelMatrix * vec4(0., 0., 0., 1.);
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    // a gentle bob on the surge
    vec3 w = c.xyz + r * (position.x * uSize) + u * (position.y * uSize + sin(uTime * 1.6 + uPhase) * 0.08);
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uGlow, uLight;
  varying vec2 vUv;
  void main(){
    vec4 t = texture2D(uMap, vUv);
    if (t.a < 0.5) discard;
    vec3 col = t.rgb * uLight;
    col += uGlow * (col * 1.2 + vec3(0.35, 0.9, 1.0) * 0.5); // the shiny glint (PokemonLayer)
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export const HALO_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uGlow;
  varying vec2 vUv;
  void main(){
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d) * smoothstep(1.0, 0.0, d) * uGlow * 0.6;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

interface Slot { group: THREE.Group; sprite: THREE.ShaderMaterial; halo: THREE.ShaderMaterial; id: BerryId | null }

export function BerryLayer() {
  const root = useRef<THREE.Group>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const slots = useMemo<Slot[]>(() => Array.from({ length: POOL }, () => {
    const sprite = new THREE.ShaderMaterial({
      transparent: false, depthWrite: true,
      uniforms: { uMap: { value: textureOf(BERRY_IDS[0]) }, uGlow: { value: 0 }, uLight: { value: 1 }, uTime: { value: 0 }, uPhase: { value: 0 }, uSize: { value: BERRY_RULES.SPRITE_SIZE } },
      vertexShader: BILLBOARD_VERT, fragmentShader: SPRITE_FRAG,
    });
    const halo = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#67e8f9') }, uGlow: { value: 0 }, uTime: { value: 0 }, uPhase: { value: 0 }, uSize: { value: BERRY_RULES.HALO_SIZE } },
      vertexShader: BILLBOARD_VERT, fragmentShader: HALO_FRAG,
    });
    const group = new THREE.Group();
    const haloMesh = new THREE.Mesh(geo, halo); haloMesh.renderOrder = 2; haloMesh.frustumCulled = false;
    const spriteMesh = new THREE.Mesh(geo, sprite); spriteMesh.renderOrder = 3; spriteMesh.frustumCulled = false;
    group.add(haloMesh, spriteMesh);
    group.visible = false;
    return { group, sprite, halo, id: null };
  }), [geo]);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    for (const s of slots) r.add(s.group);
    return () => { for (const s of slots) { r.remove(s.group); s.sprite.dispose(); s.halo.dispose(); } geo.dispose(); };
  }, [slots, geo]);

  useFrame((state) => {
    const floor = session.berries.floor;
    const time = state.clock.elapsedTime;
    const light = 0.5 + session.lighting.ambient * 0.7;
    for (let i = 0; i < POOL; i++) {
      const s = slots[i], b = floor[i];
      if (!b) { s.group.visible = false; continue; }
      if (s.id !== b.id) { s.id = b.id; s.sprite.uniforms.uMap.value = textureOf(b.id); (s.halo.uniforms.uColor.value as THREE.Color).set(BERRIES[b.id].color).lerp(new THREE.Color('#67e8f9'), 0.45); }
      const glow = 0.22 + 0.12 * Math.sin(time * 3.5 + b.phase * 5); // the shiny pulse
      s.group.visible = true;
      s.group.position.set(b.x, b.y, b.z);
      s.sprite.uniforms.uGlow.value = glow; s.sprite.uniforms.uLight.value = light; s.sprite.uniforms.uTime.value = time; s.sprite.uniforms.uPhase.value = b.phase;
      s.halo.uniforms.uGlow.value = glow + 0.25; s.halo.uniforms.uTime.value = time; s.halo.uniforms.uPhase.value = b.phase;
    }
  });

  return <group ref={root} />;
}
