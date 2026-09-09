/**
 * Actor visuals.
 *
 * HONEST PLACEHOLDERS: no production meshes exist for this slice, so every
 * actor is built procedurally to the presentation contract in content/actors.js
 * — correct footprint, height, pivot, facing and sockets — and is drawn with a
 * visible wireframe overlay and a team ring so nobody can mistake it for final
 * art. Swapping in a real mesh means matching the contract, not editing
 * gameplay code.
 */
import * as THREE from 'three';

const TEAM_RING = {
  marches: '#8fb2c9',
  kaldreich: '#c2703f',
  neutral: '#cfc6a8',
};

const TELEGRAPH_COLOR = {
  aim: '#ffb454',
  lob: '#ff5b4a',
  bash: '#ff8a3c',
  default: '#ffd08a',
};

const FLASH_TIME = 0.14;

let placeholderLogged = false;

export function createActorView(def, { quality = 'high', team = 'kaldreich' } = {}) {
  if (!placeholderLogged) {
    placeholderLogged = true;
    console.info(
      '[assets] Using procedural placeholder actors (no imported meshes). ' +
        'Footprint, height, pivot, facing and sockets follow the authored presentation contract.',
    );
  }

  const palette = def.palette;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const coatMat = new THREE.MeshStandardMaterial({ color: palette.coat, roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.5, metalness: 0.55 });
  const maskMat = new THREE.MeshStandardMaterial({ color: palette.mask, roughness: 0.7 });

  const h = def.height;
  const legH = h * 0.44;
  const torsoH = h * 0.36;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.19, legH, 0.24), maskMat);
  const legR = legL.clone();
  legL.position.set(-0.14, legH / 2, 0);
  legR.position.set(0.14, legH / 2, 0);
  body.add(legL, legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, torsoH, 0.34), coatMat);
  torso.position.y = legH + torsoH / 2;
  body.add(torso);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, torsoH * 0.6, 0.18), trimMat);
  pack.position.set(0, legH + torsoH * 0.55, -0.24);
  body.add(pack);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), maskMat);
  head.position.y = legH + torsoH + 0.15;
  body.add(head);

  // Gas-mask lenses: the one detail that reads at gameplay camera distance.
  const lensGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const lensMat = new THREE.MeshStandardMaterial({ color: '#1b1c19', roughness: 0.25, metalness: 0.8 });
  const lensL = new THREE.Mesh(lensGeo, lensMat);
  const lensR = new THREE.Mesh(lensGeo, lensMat);
  lensL.position.set(-0.07, legH + torsoH + 0.17, 0.14);
  lensR.position.set(0.07, legH + torsoH + 0.17, 0.14);
  body.add(lensL, lensR);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), metalMat);
  helmet.position.y = legH + torsoH + 0.28;
  body.add(helmet);

  // Arms + weapon live in one pivot so aim and swing are a single rotation.
  const arms = new THREE.Group();
  arms.position.set(0, legH + torsoH * 0.78, 0.1);
  body.add(arms);

  // Arms angle inward so the hands meet on the weapon; without this the
  // silhouette reads as a scarecrow rather than a soldier at port arms.
  const armGeo = new THREE.BoxGeometry(0.13, 0.13, 0.46);
  const armL = new THREE.Mesh(armGeo, coatMat);
  armL.position.set(-0.21, -0.02, 0.18);
  armL.rotation.y = 0.34;
  const armR = new THREE.Mesh(armGeo, coatMat);
  armR.position.set(0.21, -0.02, 0.18);
  armR.rotation.y = -0.34;
  arms.add(armL, armR);

  const shoulderGeo = new THREE.BoxGeometry(0.16, 0.15, 0.2);
  const shoulderL = new THREE.Mesh(shoulderGeo, trimMat);
  shoulderL.position.set(-0.27, 0.03, -0.02);
  const shoulderR = new THREE.Mesh(shoulderGeo, trimMat);
  shoulderR.position.set(0.27, 0.03, -0.02);
  arms.add(shoulderL, shoulderR);

  let weapon = null;
  if ((def.moves ?? []).length) {
    weapon = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.86), metalMat);
    stock.position.z = 0.24;
    weapon.add(stock);
    const bayonet = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.032, 0.32), metalMat);
    bayonet.position.z = 0.82;
    weapon.add(bayonet);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.1), metalMat);
    magazine.position.set(0, -0.1, 0.2);
    weapon.add(magazine);
    weapon.position.set(0.03, -0.04, 0.24);
    weapon.rotation.x = 0.14; // muzzle rides low until the actor aims
    arms.add(weapon);
  }

  // ---- readability overlays -------------------------------------------
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(def.radius * 0.86, def.radius, 20),
    new THREE.MeshBasicMaterial({
      color: TEAM_RING[team] ?? '#cccccc',
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  // The placeholder tell: a visible wireframe cage over the silhouette.
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, h, 0.42)),
    new THREE.LineBasicMaterial({ color: '#8e9aa3', transparent: true, opacity: 0.16 }),
  );
  cage.position.y = h / 2;
  root.add(cage);

  const telegraph = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.055, 6, 18),
    new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR.default, transparent: true, opacity: 0.9 }),
  );
  telegraph.rotation.x = -Math.PI / 2;
  telegraph.position.y = h + 0.26;
  telegraph.visible = false;
  root.add(telegraph);

  // Health / posture bar, billboarded in update().
  const bar = new THREE.Group();
  bar.position.y = h + 0.55;
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.09),
    new THREE.MeshBasicMaterial({ color: '#15171a', transparent: true, opacity: 0.75, depthTest: false }),
  );
  const barFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.055),
    new THREE.MeshBasicMaterial({ color: '#c9553f', depthTest: false }),
  );
  barFill.position.z = 0.001;
  const postureFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.02),
    new THREE.MeshBasicMaterial({ color: '#e2c56a', depthTest: false }),
  );
  postureFill.position.set(0, -0.045, 0.001);
  bar.add(barBg, barFill, postureFill);
  bar.renderOrder = 10;
  bar.visible = false;
  root.add(bar);

  if (quality === 'high') {
    torso.castShadow = true;
    head.castShadow = true;
    legL.castShadow = true;
    legR.castShadow = true;
  }

  const state = { walkPhase: 0, deathT: 0, flash: 0 };

  return {
    group: root,
    /** world-space socket lookup, used by VFX so effects start where they should */
    socket(name) {
      const s = def.sockets[name];
      if (!s) return root.position.clone();
      return root.localToWorld(new THREE.Vector3(s.x, s.y, s.z));
    },
    flashHit() {
      state.flash = FLASH_TIME;
    },
    update(entity, ctx) {
      const dt = ctx.dt;
      root.position.set(entity.pos.x, 0, entity.pos.z);
      // The geometry above is authored facing local +Z (see the presentation
      // contract in content/actors.js), and math2's forward(a) is (sin a, cos a).
      // Rotating local +Z by `facing` therefore lands exactly on forward(facing).
      // Do NOT add PI here: that is the convention for -Z-facing imported meshes.
      root.rotation.y = entity.facing;

      const speed = Math.hypot(entity.vel.x, entity.vel.z);
      state.walkPhase += dt * (2.4 + speed * 1.5);

      // --- death / downed poses
      if (!entity.alive) {
        state.deathT = Math.min(1, state.deathT + dt * 2.6);
        body.rotation.x = -Math.PI / 2 * state.deathT;
        body.position.y = -0.1 * state.deathT;
        ring.visible = false;
        cage.visible = false;
        telegraph.visible = false;
        bar.visible = false;
        return;
      }
      if (entity.downed) {
        body.rotation.x = -Math.PI / 2.2;
        body.position.y = -0.05;
        ring.material.color.set('#e0b24a');
        ring.material.opacity = 0.5 + Math.sin(ctx.time * 5) * 0.3;
        telegraph.visible = false;
        bar.visible = false;
        return;
      }

      body.rotation.x = 0;
      body.position.y = 0;

      // --- locomotion
      const stride = Math.min(1, speed / (def.speed || 4));
      legL.rotation.x = Math.sin(state.walkPhase) * 0.55 * stride;
      legR.rotation.x = -Math.sin(state.walkPhase) * 0.55 * stride;
      body.position.y = Math.abs(Math.sin(state.walkPhase)) * 0.035 * stride;

      // --- action poses, driven by the authored move phase
      const action = entity.action;
      let aimBlend = 0;
      let telegraphOn = false;
      if (weapon) weapon.rotation.x += (0.14 - weapon.rotation.x) * Math.min(1, dt * 10);
      if (action) {
        const m = action.move;
        const isMelee = m.tags?.includes('melee');
        const isRelic = m.tags?.includes('relic');
        const inStartup = action.t < m.startup;
        if (isMelee) {
          const swing = Math.min(1, action.t / Math.max(0.001, m.startup));
          arms.rotation.x = inStartup ? -0.9 * swing : 0.7;
          aimBlend = 0.4;
        } else if (isRelic) {
          arms.rotation.x = -0.5 - (inStartup ? 0.5 * (action.t / m.startup) : 0);
          aimBlend = 1;
        } else {
          arms.rotation.x = -0.12;
          if (weapon) weapon.rotation.x = 0; // shouldered and level while firing
          aimBlend = 1;
        }
        telegraphOn = inStartup && !!m.telegraph;
        if (telegraphOn) {
          telegraph.material.color.set(TELEGRAPH_COLOR[m.telegraph] ?? TELEGRAPH_COLOR.default);
          const pulse = 0.6 + 0.4 * Math.sin((action.t / m.startup) * Math.PI * 6);
          telegraph.scale.setScalar(0.9 + pulse * 0.25);
          telegraph.material.opacity = 0.55 + pulse * 0.4;
        }
      } else {
        arms.rotation.x += (0 - arms.rotation.x) * Math.min(1, dt * 8);
      }
      telegraph.visible = telegraphOn;

      if (entity.staggerT > 0) {
        body.rotation.x = 0.28;
        arms.rotation.x = 0.5;
      }

      // --- damage flash: brief and low, so a hit reads without repainting the
      // actor. Burning outranks it because it is a lasting gameplay state.
      const burning = entity.statuses.some((s) => s.id === 'burning');
      state.flash = Math.max(0, state.flash - dt);
      if (burning) {
        coatMat.emissive.setRGB(0.03, 0.14, 0.3);
      } else if (state.flash > 0) {
        const k = state.flash / FLASH_TIME;
        coatMat.emissive.setRGB(k * 0.34, k * 0.05, k * 0.03);
      } else {
        coatMat.emissive.setRGB(0, 0, 0);
      }

      // --- cover tell on the team ring
      ring.material.color.set(TEAM_RING[team] ?? '#cccccc');
      ring.material.opacity = entity.inCover ? 0.9 : 0.4;

      // --- health bar
      const hurt = entity.hp < entity.maxHp - 0.01;
      bar.visible = ctx.showBar !== false && hurt && entity.kind !== 'player';
      if (bar.visible) {
        const frac = Math.max(0, entity.hp / entity.maxHp);
        barFill.scale.x = Math.max(0.001, frac);
        barFill.position.x = -(1 - frac) * 0.43;
        const pf = Math.max(0, entity.posture / entity.maxPosture);
        postureFill.scale.x = Math.max(0.001, pf);
        postureFill.position.x = -(1 - pf) * 0.43;
        if (ctx.camera) bar.quaternion.copy(ctx.camera.quaternion);
      }
    },
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose?.();
      });
    },
  };
}
