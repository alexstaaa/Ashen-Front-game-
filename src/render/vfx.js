/**
 * VFX. Every effect exists to make an already-resolved gameplay fact visible:
 * a shot was fired, a hit landed, a grenade is about to go off, a relic burned.
 *
 * Rules enforced here:
 *   - short-lived objects are pooled and reused; no per-frame allocation
 *   - each effect type has a hard spawn cap
 *   - cleanup is idempotent, so reset/death/pause cannot leak an effect
 *   - reduced motion swaps spectacle for a quieter, still-readable cue
 */
import * as THREE from 'three';

const CAPS = { tracer: 24, flash: 16, impact: 20, blast: 6, cone: 4, particles: 18 };

export function createVfx(scene, { quality = 'high', reducedMotion = false } = {}) {
  const root = new THREE.Group();
  root.name = 'vfx';
  scene.add(root);

  const geo = {
    beam: new THREE.BoxGeometry(0.028, 0.028, 1),
    sphere: new THREE.SphereGeometry(1, 10, 8),
    ring: new THREE.RingGeometry(0.86, 1, 24),
  };

  /**
   * Unit ground sector centred on local +X, cached per cone angle. Combined
   * with `rotation.set(-PI/2, 0, yaw - PI/2)` it lands exactly on the aim
   * direction, matching the contact test in sim/combat.js.
   */
  const sectorCache = new Map();
  function sectorGeometry(coneDeg) {
    let g = sectorCache.get(coneDeg);
    if (!g) {
      const half = (coneDeg * Math.PI) / 360;
      g = new THREE.CircleGeometry(1, 26, -half, half * 2);
      sectorCache.set(coneDeg, g);
    }
    return g;
  }

  const mat = {
    tracer: new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.9, depthWrite: false }),
    flash: new THREE.MeshBasicMaterial({
      color: '#ffcf7a',
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    impact: new THREE.MeshBasicMaterial({ color: '#b9ac93', transparent: true, opacity: 0.9, depthWrite: false }),
    blood: new THREE.MeshBasicMaterial({ color: '#8c3a2e', transparent: true, opacity: 0.9, depthWrite: false }),
    blast: new THREE.MeshBasicMaterial({
      color: '#ff8a44',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    danger: new THREE.MeshBasicMaterial({
      color: '#ff4d3d',
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    relic: new THREE.MeshBasicMaterial({
      color: '#63b7e6',
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    grenade: new THREE.MeshBasicMaterial({ color: '#4a4438' }),
  };

  /** One pool per (geometry, material) pair, so nothing is allocated in flight. */
  const pools = new Map();
  function acquire(key, geometry, material) {
    let pool = pools.get(key);
    if (!pool) {
      pool = { free: [], live: 0 };
      pools.set(key, pool);
    }
    const mesh = pool.free.pop() ?? new THREE.Mesh(geometry, material.clone());
    mesh.visible = true;
    root.add(mesh);
    pool.live++;
    return mesh;
  }
  function release(key, mesh) {
    const pool = pools.get(key);
    root.remove(mesh);
    mesh.visible = false;
    mesh.scale.setScalar(1);
    mesh.rotation.set(0, 0, 0);
    if (pool) {
      pool.live = Math.max(0, pool.live - 1);
      pool.free.push(mesh);
    }
  }
  const liveCount = (key) => pools.get(key)?.live ?? 0;

  const effects = [];
  const markers = new Map();
  const grenades = new Map();

  function spawn(key, geometry, material, life, init, step) {
    if (liveCount(key) >= (CAPS[key] ?? 12)) return null;
    const mesh = acquire(key, geometry, material);
    init?.(mesh);
    effects.push({ key, mesh, t: 0, life, step });
    return mesh;
  }

  const api = {
    root,

    tracer(from, to, color = '#ffd9a0') {
      const a = new THREE.Vector3(from.x, from.y ?? 1.3, from.z);
      const b = new THREE.Vector3(to.x, to.y ?? 1.2, to.z);
      const length = a.distanceTo(b);
      spawn(
        'tracer',
        geo.beam,
        mat.tracer,
        reducedMotion ? 0.05 : 0.075,
        (m) => {
          m.material.color.set(color);
          m.material.opacity = 0.9;
          m.position.copy(a).add(b).multiplyScalar(0.5);
          m.lookAt(b);
          m.scale.set(1, 1, length);
        },
        (m, k) => {
          m.material.opacity = 0.9 * (1 - k);
        },
      );
    },

    /**
     * A small additive bloom at the muzzle. Deliberately tiny: it marks where
     * the shot came from without painting over the shooter's silhouette.
     */
    muzzle(pos) {
      spawn(
        'flash',
        geo.sphere,
        mat.flash,
        0.05,
        (m) => {
          m.position.set(pos.x, pos.y ?? 1.3, pos.z);
          m.scale.setScalar(0.075);
          m.material.opacity = 0.85;
        },
        (m, k) => {
          m.material.opacity = 0.85 * (1 - k);
          m.scale.setScalar(0.075 + k * 0.075);
        },
      );
    },

    impact(pos, kind = 'dust') {
      const material = kind === 'blood' ? mat.blood : mat.impact;
      const count = reducedMotion || quality === 'low' ? 1 : 3;
      for (let i = 0; i < count; i++) {
        const vx = (Math.random() - 0.5) * 2.4;
        const vy = 1.2 + Math.random() * 1.8;
        const vz = (Math.random() - 0.5) * 2.4;
        spawn(
          'impact',
          geo.sphere,
          material,
          0.34,
          (m) => {
            m.position.set(pos.x, (pos.y ?? 1.1) + 0.1, pos.z);
            m.scale.setScalar(0.06);
            m.material.opacity = 0.9;
          },
          (m, k, dt) => {
            m.position.x += vx * dt;
            m.position.y += (vy - k * 4.5) * dt;
            m.position.z += vz * dt;
            m.material.opacity = 0.9 * (1 - k);
            m.scale.setScalar(0.06 + k * 0.05);
          },
        );
      }
    },

    /** Expanding blast plus a ground ring, so the danger area stays legible. */
    explosion(pos, radius) {
      spawn(
        'blast',
        geo.sphere,
        mat.blast,
        0.42,
        (m) => {
          m.position.set(pos.x, 0.7, pos.z);
          m.scale.setScalar(0.4);
          m.material.opacity = 0.85;
        },
        (m, k) => {
          m.scale.setScalar(0.4 + k * radius);
          m.material.opacity = 0.85 * (1 - k);
        },
      );
      spawn(
        'blast',
        geo.ring,
        mat.danger,
        0.5,
        (m) => {
          m.rotation.x = -Math.PI / 2;
          m.position.set(pos.x, 0.05, pos.z);
          m.scale.setScalar(radius * 0.5);
          m.material.opacity = 0.7;
        },
        (m, k) => {
          m.scale.setScalar(radius * (0.5 + k * 0.6));
          m.material.opacity = 0.7 * (1 - k);
        },
      );
    },

    /**
     * The relic's contact shape, drawn flat on the ground as the exact sector
     * the simulation resolved. A ground decal beats a volumetric cone here: it
     * shows precisely who was inside without blinding the player who cast it.
     */
    relicCone(pos, dir, range, coneDeg) {
      const geometry = sectorGeometry(coneDeg);
      const angle = Math.atan2(dir.x, dir.z) - Math.PI / 2;
      spawn(
        'cone',
        geometry,
        mat.relic,
        reducedMotion ? 0.2 : 0.36,
        (m) => {
          m.position.set(pos.x, 0.07, pos.z);
          m.rotation.set(-Math.PI / 2, 0, angle);
          m.scale.setScalar(range * 0.25);
          m.material.opacity = 0.5;
        },
        (m, k) => {
          m.scale.setScalar(range * (0.25 + k * 0.75));
          m.material.opacity = 0.5 * (1 - k * k);
        },
      );
      // A brief low flare at the caster, so the source of the cone is obvious.
      spawn(
        'flash',
        geo.sphere,
        mat.relic,
        0.22,
        (m) => {
          m.position.set(pos.x + dir.x * 0.5, 1.1, pos.z + dir.z * 0.5);
          m.scale.setScalar(0.22);
          m.material.opacity = 0.7;
        },
        (m, k) => {
          m.scale.setScalar(0.22 + k * 0.5);
          m.material.opacity = 0.7 * (1 - k);
        },
      );
    },

    // ---- persistent, id-keyed effects ---------------------------------

    grenadeSpawned(id, from, to, flightTime) {
      const mesh = acquire('grenade', geo.sphere, mat.grenade);
      mesh.scale.setScalar(0.12);
      mesh.position.set(from.x, 1.1, from.z);
      grenades.set(id, { mesh, from: { ...from }, to: { ...to }, t: 0, flightTime });
    },

    /** The ring that says "leave, now" — the counterplay to the grenadier. */
    grenadeMarker(id, pos, radius, fuse) {
      api.clearMarker(id);
      const mesh = acquire('marker', geo.ring, mat.danger);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, 0.06, pos.z);
      mesh.scale.setScalar(radius);
      markers.set(id, { mesh, t: 0, fuse });
      const g = grenades.get(id);
      if (g) g.landed = true;
    },

    clearMarker(id) {
      const marker = markers.get(id);
      if (marker) {
        release('marker', marker.mesh);
        markers.delete(id);
      }
      const g = grenades.get(id);
      if (g) {
        release('grenade', g.mesh);
        grenades.delete(id);
      }
    },

    update(dt, time) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i];
        fx.t += dt;
        const k = Math.min(1, fx.t / fx.life);
        fx.step?.(fx.mesh, k, dt);
        if (fx.t >= fx.life) {
          release(fx.key, fx.mesh);
          effects.splice(i, 1);
        }
      }

      for (const g of grenades.values()) {
        if (g.landed) continue;
        g.t += dt;
        const k = Math.min(1, g.t / g.flightTime);
        g.mesh.position.set(
          g.from.x + (g.to.x - g.from.x) * k,
          1.1 + Math.sin(k * Math.PI) * 2.6, // visual arc only; the sim is flat
          g.from.z + (g.to.z - g.from.z) * k,
        );
        g.mesh.rotation.x += dt * 9;
      }

      for (const m of markers.values()) {
        m.t += dt;
        const urgency = Math.min(1, m.t / Math.max(0.001, m.fuse));
        const pulse = 0.5 + 0.5 * Math.sin(time * (8 + urgency * 26));
        m.mesh.material.opacity = 0.35 + pulse * 0.5;
        m.mesh.scale.setScalar(m.mesh.scale.x); // radius is fixed; only alpha pulses
      }
    },

    /** Idempotent: safe to call on reset, death, pause or scene teardown. */
    clear() {
      for (let i = effects.length - 1; i >= 0; i--) release(effects[i].key, effects[i].mesh);
      effects.length = 0;
      for (const id of [...markers.keys()]) api.clearMarker(id);
      for (const id of [...grenades.keys()]) api.clearMarker(id);
    },

    stats() {
      return {
        active: effects.length,
        markers: markers.size,
        grenades: grenades.size,
        pooled: [...pools.values()].reduce((s, p) => s + p.free.length, 0),
      };
    },
  };

  return api;
}
