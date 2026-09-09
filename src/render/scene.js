/**
 * World rendering. Geometry here is presentation only — the simulation never
 * reads it back. Obstacle meshes are drawn from the same authored records the
 * collision system uses, so what you see is what you bump into.
 *
 * Lighting follows the level's source-to-light inventory: every local light is
 * created as a child of a visible emitter, and disabling the emitter disables
 * the light. There is no way to add a floating light through this module.
 */
import * as THREE from 'three';

const LOW_HEIGHT = 1.05;
const HIGH_HEIGHT = 2.7;

/** Three's lighting is physical; the authored numbers are art-facing. */
const POINT_LIGHT_GAIN = 14;
const SUN_GAIN = 2.6;
const HEMI_GAIN = 2.3;

function noiseTexture(size, base, speck, density = 0.35) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = speck;
  for (let i = 0; i < size * size * density * 0.05; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2.4 + 0.4;
    ctx.globalAlpha = 0.05 + Math.random() * 0.25;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function gradientTexture(top, bottom) {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.62, bottom);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  return new THREE.CanvasTexture(canvas);
}

export function createRenderScene(canvas, level, options = {}) {
  const quality = options.quality ?? 'high';
  const reducedMotion = !!options.reducedMotion;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality !== 'low',
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 1.75));
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(level.fog.color);
  scene.fog = new THREE.Fog(level.fog.color, level.fog.near, level.fog.far);

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 400);

  // Overcast dome. Unlit and unfogged: it is the horizon, not a light source.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 20, 14),
    new THREE.MeshBasicMaterial({
      map: gradientTexture(level.sky.top, level.sky.bottom),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // ------------------------------------------------------------- ground
  const groundTex = noiseTexture(512, level.ground.color, level.ground.mud, 0.6);
  groundTex.repeat.set(26, 40);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(level.bounds.w + 80, level.bounds.d + 80),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = quality === 'high';
  scene.add(ground);

  // ---------------------------------------------------- obstacle geometry
  const obstacleGroup = new THREE.Group();
  obstacleGroup.name = 'obstacles';
  scene.add(obstacleGroup);

  const parapetMat = new THREE.MeshStandardMaterial({
    map: noiseTexture(256, '#5a5346', '#3b352c', 0.8),
    roughness: 1,
  });
  const sandbagMat = new THREE.MeshStandardMaterial({
    map: noiseTexture(256, '#6b6350', '#4a442f', 0.9),
    roughness: 1,
  });
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#54534d', roughness: 0.95 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#4a463d', roughness: 0.85, metalness: 0.15 });

  const emitterAnchors = new Map();

  for (const o of level.obstacles) {
    const height = o.height === 'high' ? HIGH_HEIGHT : LOW_HEIGHT;
    let mesh;

    if (o.kind === 'wire') {
      mesh = buildWire(o);
    } else if (o.kind === 'truck') {
      mesh = buildTruck(o, metalMat);
    } else if (o.kind === 'bunker' || o.kind === 'shelter') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.kind === 'bunker' ? 3.6 : 3.1, o.d), concreteMat);
      mesh.position.y = (o.kind === 'bunker' ? 3.6 : 3.1) / 2;
    } else {
      const mat = o.height === 'high' ? parapetMat : sandbagMat;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, height, o.d), mat);
      mesh.position.y = height / 2;
      if (o.height === 'low') {
        // A row of individual sandbags on the lip, so low cover reads as low
        // cover from the gameplay camera without inflating the silhouette.
        const alongX = o.w >= o.d;
        const span = alongX ? o.w : o.d;
        const bagLen = 0.62;
        const count = Math.max(1, Math.floor(span / bagLen));
        const radius = Math.min(0.24, Math.min(o.w, o.d) * 0.28);
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) * (span / count) - span / 2;
          const bag = new THREE.Mesh(new THREE.CapsuleGeometry(radius, bagLen * 0.55, 2, 6), sandbagMat);
          bag.rotation.z = Math.PI / 2;
          if (!alongX) bag.rotation.y = Math.PI / 2;
          bag.position.set(alongX ? t : (i % 2 ? 0.06 : -0.06), height / 2 + radius * 0.5, alongX ? (i % 2 ? 0.05 : -0.05) : t);
          mesh.add(bag);
        }
      }
    }

    const group = new THREE.Group();
    group.position.set(o.x, 0, o.z);
    group.add(mesh);
    group.userData.obstacleId = o.id;
    mesh.castShadow = quality === 'high';
    mesh.receiveShadow = quality === 'high';
    obstacleGroup.add(group);
    emitterAnchors.set(o.id, group);
  }

  // --------------------------------------------------------- dressing
  const dressing = new THREE.Group();
  dressing.name = 'dressing (non-colliding background only)';
  scene.add(dressing);
  buildDressing(dressing, level, quality);

  // --------------------------------------------------------- lighting
  const lightRig = createLightRig(scene, level, { quality, reducedMotion, emitterAnchors });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    THREE,
    renderer,
    scene,
    camera,
    lightRig,
    obstacleGroup,
    resize,
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}

// ------------------------------------------------------------ sub-builders

function buildWire(o) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: '#3b352c', roughness: 1 });
  const wireMat = new THREE.LineBasicMaterial({ color: '#6d6656' });
  const span = Math.max(o.w, o.d);
  const along = o.w >= o.d ? 'x' : 'z';
  const count = Math.max(2, Math.round(span / 2.2));
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1) - 0.5) * span;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 5), postMat);
    post.position.set(along === 'x' ? t : 0, 0.55, along === 'z' ? t : 0);
    post.rotation.z = (i % 3) * 0.05 - 0.05;
    group.add(post);
    for (const h of [0.35, 0.7, 1.0]) {
      points.push(
        new THREE.Vector3(along === 'x' ? t : 0, h, along === 'z' ? t : 0),
        new THREE.Vector3(
          along === 'x' ? t + span / count : 0.25,
          h + (i % 2 ? 0.12 : -0.12),
          along === 'z' ? t + span / count : 0.25,
        ),
      );
    }
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), wireMat));
  return group;
}

function buildTruck(o, metalMat) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.92, 1.5, o.d * 0.9), metalMat);
  body.position.y = 1.05;
  body.rotation.z = 0.07;
  group.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, o.d * 0.85), metalMat);
  cab.position.set(o.w * 0.32, 1.75, 0);
  group.add(cab);
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.35, 10);
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#22201c', roughness: 1 });
  for (const [wx, wz] of [
    [-1.7, o.d * 0.42],
    [-1.7, -o.d * 0.42],
    [1.7, o.d * 0.42],
    [1.7, -o.d * 0.42],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.5, wz);
    group.add(wheel);
  }
  return group;
}

function buildDressing(root, level, quality) {
  const craterMat = new THREE.MeshStandardMaterial({ color: '#2f2b24', roughness: 1 });
  const boardMat = new THREE.MeshStandardMaterial({ color: '#4d4437', roughness: 1 });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#2e2a24', roughness: 1 });
  const paperMat = new THREE.MeshStandardMaterial({ color: '#b8b2a0', roughness: 1 });
  const ridgeMat = new THREE.MeshBasicMaterial({ color: '#5c5f63', fog: true });

  for (const d of level.dressing) {
    if (d.kind === 'crater') {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(d.r, 18), craterMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(d.x, 0.015, d.z);
      root.add(disc);
    } else if (d.kind === 'duckboard') {
      const planks = new THREE.Group();
      const rows = Math.round(d.d / 0.5);
      for (let i = 0; i < rows; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.06, 0.34), boardMat);
        p.position.set(0, 0.03, -d.d / 2 + i * 0.5);
        planks.add(p);
      }
      planks.position.set(d.x, 0, d.z);
      root.add(planks);
    } else if (d.kind === 'deadtree') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.28, d.h, 6), woodMat);
      trunk.position.set(d.x, d.h / 2, d.z);
      trunk.rotation.z = 0.12;
      root.add(trunk);
      for (let i = 0; i < 3; i++) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, d.h * 0.35, 5), woodMat);
        branch.position.set(d.x + (i - 1) * 0.4, d.h * (0.6 + i * 0.08), d.z);
        branch.rotation.z = (i - 1) * 0.9;
        root.add(branch);
      }
    } else if (d.kind === 'post') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, d.h, 5), woodMat);
      post.position.set(d.x, d.h / 2, d.z);
      root.add(post);
    } else if (d.kind === 'ridge') {
      const ridge = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), ridgeMat);
      ridge.position.set(d.x, d.h / 2 - 2, d.z);
      if (d.z < 0) ridge.rotation.y = Math.PI;
      root.add(ridge);
    } else if (d.kind === 'graves') {
      for (let i = 0; i < d.count; i++) {
        const cross = new THREE.Group();
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), woodMat);
        v.position.y = 0.35;
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.08), woodMat);
        h.position.y = 0.52;
        cross.add(v, h);
        cross.position.set(d.x + (i % 3) * 0.9, 0, d.z + Math.floor(i / 3) * 1.1);
        cross.rotation.z = ((i * 37) % 11) * 0.012 - 0.06;
        root.add(cross);
      }
    } else if (d.kind === 'letters') {
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), paperMat);
      paper.rotation.x = -Math.PI / 2;
      paper.rotation.z = 0.6;
      paper.position.set(d.x, 0.02, d.z);
      root.add(paper);
    }
  }
  if (quality === 'low') root.visible = true; // dressing is cheap; kept for readability
}

// ---------------------------------------------------------------- lighting

/**
 * Builds the level's lighting from its declared inventory. Local lights are
 * children of their emitter group, so a hidden or removed emitter can never
 * leave a light behind.
 */
export function createLightRig(scene, level, { quality, reducedMotion, emitterAnchors }) {
  const cfg = level.lights;
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(cfg.ambient.hemisphere.sky),
    new THREE.Color(cfg.ambient.hemisphere.ground),
    cfg.ambient.hemisphere.intensity * HEMI_GAIN,
  );
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(cfg.ambient.sun.color), cfg.ambient.sun.intensity * SUN_GAIN);
  const dir = cfg.ambient.sun.direction;
  sun.position.set(-dir.x * 60, -dir.y * 60, -dir.z * 60);
  if (quality === 'high') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.camera.far = 180;
    sun.shadow.bias = -0.0012;
  }
  scene.add(sun);
  scene.add(sun.target);

  const emitters = new Map();

  for (const spec of cfg.local) {
    const group = new THREE.Group();
    group.name = spec.emitterId;
    group.position.set(spec.emitter.x, 0, spec.emitter.z);

    const visual = buildEmitterVisual(spec.emitter);
    group.add(visual);

    const light = new THREE.PointLight(
      new THREE.Color(spec.color),
      spec.intensity * POINT_LIGHT_GAIN,
      spec.range,
      2,
    );
    light.position.set(spec.attach.x, spec.attach.y, spec.attach.z);
    light.castShadow = false;
    group.add(light);

    // Attaching to the obstacle group means a moved or removed prop takes its
    // light with it, which is exactly the rule we want to be unable to break.
    const anchor = spec.emitter.attachedTo ? emitterAnchors.get(spec.emitter.attachedTo) : null;
    if (anchor) {
      group.position.set(spec.emitter.x - anchor.position.x, 0, spec.emitter.z - anchor.position.z);
      anchor.add(group);
    } else {
      scene.add(group);
    }

    emitters.set(spec.id, { spec, group, light, visual, baseIntensity: light.intensity, enabled: true });
  }

  const runtimeLights = [];

  return {
    sun,
    hemi,
    emitters,

    /** Disabling an emitter hides the prop and kills its light together. */
    setEmitterEnabled(lightId, enabled) {
      const entry = emitters.get(lightId);
      if (!entry) return false;
      entry.enabled = enabled;
      entry.group.visible = enabled;
      entry.light.intensity = enabled ? entry.baseIntensity : 0;
      return true;
    },

    /** A flare: one visible emitter carrying one light, both on one lifetime. */
    spawnFlare(pos) {
      const spec = level.lights.runtime.find((r) => r.id === 'lt_flare');
      const group = new THREE.Group();
      group.position.set(pos.x, 1.2, pos.z);
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshBasicMaterial({ color: spec.color }),
      );
      group.add(body);
      const light = new THREE.PointLight(new THREE.Color(spec.color), spec.intensity * POINT_LIGHT_GAIN, spec.range, 2);
      group.add(light);
      scene.add(group);
      runtimeLights.push({ group, light, t: 0, life: spec.lifetime, base: light.intensity });
      return group;
    },

    update(dt, time) {
      for (const entry of emitters.values()) {
        if (!entry.enabled) continue;
        const flicker = entry.spec.flicker ?? 0;
        if (flicker > 0 && !reducedMotion) {
          const n =
            Math.sin(time * 11.3 + entry.spec.id.length) * 0.5 +
            Math.sin(time * 27.7 + entry.spec.range) * 0.5;
          entry.light.intensity = entry.baseIntensity * (1 + n * flicker * 0.5);
        }
        if (entry.visual.userData.flame) {
          entry.visual.userData.flame.scale.y = 1 + Math.sin(time * 9 + 1.2) * 0.14;
        }
      }
      for (let i = runtimeLights.length - 1; i >= 0; i--) {
        const rl = runtimeLights[i];
        rl.t += dt;
        const k = 1 - rl.t / rl.life;
        rl.light.intensity = rl.base * Math.max(0, k);
        rl.group.position.y = Math.max(0.3, 1.2 + Math.sin(rl.t * 0.8) * 0.4 - rl.t * 0.06);
        if (rl.t >= rl.life) {
          // emitter and light are removed as one object; nothing is left behind
          scene.remove(rl.group);
          rl.group.traverse((o) => o.geometry?.dispose?.());
          runtimeLights.splice(i, 1);
        }
      }
    },
  };
}

function buildEmitterVisual(emitter) {
  const group = new THREE.Group();
  if (emitter.kind === 'brazier') {
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(emitter.radius, emitter.radius * 0.7, emitter.height * 0.5, 8),
      new THREE.MeshStandardMaterial({ color: '#2b2721', roughness: 0.9, metalness: 0.3 }),
    );
    bowl.position.y = emitter.height * 0.35;
    group.add(bowl);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(emitter.radius * 0.75, 0.7, 7),
      new THREE.MeshBasicMaterial({ color: '#ffab52', transparent: true, opacity: 0.85 }),
    );
    flame.position.y = emitter.height * 0.75;
    group.add(flame);
    group.userData.flame = flame;
  } else if (emitter.kind === 'wreck_fire') {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(emitter.radius, emitter.height, 8),
      new THREE.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.7 }),
    );
    flame.position.y = emitter.height * 0.7;
    group.add(flame);
    group.userData.flame = flame;
  } else if (emitter.kind === 'lamp') {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, emitter.height, 6),
      new THREE.MeshStandardMaterial({ color: '#2f2c26', roughness: 0.8 }),
    );
    post.position.y = emitter.height / 2;
    group.add(post);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(emitter.radius, 8, 8),
      new THREE.MeshBasicMaterial({ color: '#ffe0a8' }),
    );
    bulb.position.y = emitter.height;
    group.add(bulb);
  }
  return group;
}
