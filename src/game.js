/**
 * Game shell. Owns the screen state machine and wires the simulation to the
 * renderer, HUD and input. Data flows one way: input -> simulation -> events ->
 * presentation. Nothing in the presentation layer writes back into the sim.
 */
import { makeBus } from './core/events.js';
import { makeLoop, STEP } from './core/loop.js';
import { createInput } from './core/input.js';
import { loadRun, saveRun, hasSave } from './core/save.js';
import { LEVEL } from './content/level-trenchfront.js';
import { MISSION } from './content/mission-cut-the-wire.js';
import { assertContentValid } from './content/validate.js';
import { MOVES } from './content/moves.js';
import { createWorld } from './sim/world.js';
import { createMissionRuntime, populateMission, stepMission, resolveChoice } from './sim/mission.js';
import { createPlayerControl, updatePlayer, toggleLockOn, playerStatus } from './sim/player.js';
import { setOrder, updateRevive } from './sim/squad.js';
import { createRunState, recordChoice } from './sim/consequences.js';
import { createRenderScene } from './render/scene.js';
import { createActorView } from './render/actorViews.js';
import { createGameCamera } from './render/camera.js';
import { createVfx } from './render/vfx.js';
import { createHud } from './render/hud.js';
import { createScreens } from './render/screens.js';
import { applyFixture } from './debug/fixtures.js';
import { dist } from './core/math2.js';

export function createGame({ canvas, hudEl, screensEl, params }) {
  assertContentValid();

  const render = createRenderScene(canvas, LEVEL, {
    quality: params.quality,
    reducedMotion: params.reducedMotion,
  });
  const gameCamera = createGameCamera(render.camera, {
    obstacleGroup: render.obstacleGroup,
    reducedMotion: params.reducedMotion,
  });
  const vfx = createVfx(render.scene, {
    quality: params.quality,
    reducedMotion: params.reducedMotion,
  });
  const hud = createHud(hudEl);
  const screens = createScreens(screensEl);

  let run = loadRun() ?? createRunState(MISSION);
  let mode = 'title';
  let world = null;
  let runtime = null;
  let bus = null;
  let control = null;
  let views = new Map();
  let reviveState = { active: false, progress: 0 };
  let debugVisible = params.debug ?? false;
  let frameMs = 16;
  let missionSeed = params.seed;

  const input = createInput(canvas, {
    onPause: () => togglePause(),
    onDebug: () => {
      debugVisible = !debugVisible;
      hud.setDebug(debugVisible);
    },
    onOrder: (order) => {
      if (mode === 'playing' && runtime?.ally) setOrder(world, runtime.ally, order);
    },
    onLock: () => {
      if (mode === 'playing' && world?.player) toggleLockOn(world, world.player, control);
    },
  });

  const loop = makeLoop({ onStep: simStep, onRender: renderFrame });

  // -------------------------------------------------------------- lifecycle

  function startMission({ seed = missionSeed, fixture = params.fixture } = {}) {
    teardownMission();
    // A stale QA override would silently swallow the player's input.
    qaInput = null;
    missionSeed = seed;
    // A fixture is a review state, not a continuation: start from a clean run
    // so reputation and the frontline read the effect of this session only.
    if (fixture) run = createRunState(MISSION);
    bus = makeBus();
    world = createWorld({ level: LEVEL, mission: MISSION, seed, bus });
    runtime = createMissionRuntime(world, MISSION);
    control = createPlayerControl();
    populateMission(world, runtime);
    wireEvents();
    if (fixture) applyFixture(fixture, world, runtime);

    // Views for anything that already exists (spawns emit their own events).
    for (const e of world.entities) ensureView(e);

    hud.setVisible(true);
    hud.setDebug(debugVisible);
    mode = 'playing';
    screens.clear();
    input.setEnabled(true);
    loop.setPaused(false);
    loop.start();
    gameCamera.reset();
    // The click that started the mission is a user gesture, so this is allowed.
    input.capturePointer();

    if (runtime.pendingChoice) openChoice(runtime.pendingChoice);
  }

  function teardownMission() {
    for (const view of views.values()) {
      render.scene.remove(view.group);
      view.dispose();
    }
    views.clear();
    vfx.clear();
    bus?.clear();
    world = null;
    runtime = null;
  }

  function showTitle() {
    mode = 'title';
    hud.setVisible(false);
    input.setEnabled(false);
    input.releasePointer();
    loop.setPaused(true);
    screens.title({
      hasSave: hasSave(),
      onStart: () => {
        run = createRunState(MISSION);
        run.seed = missionSeed;
        showBrief();
      },
      onContinue: () => {
        run = loadRun() ?? createRunState(MISSION);
        showBrief();
      },
    });
  }

  function showBrief() {
    mode = 'brief';
    screens.brief({ mission: MISSION, run, onDeploy: () => startMission({ seed: missionSeed }) });
  }

  function togglePause() {
    if (mode === 'playing') {
      mode = 'paused';
      loop.setPaused(true);
      input.setEnabled(false);
      input.releasePointer();
      screens.pause({
        onResume: () => {
          mode = 'playing';
          screens.clear();
          input.setEnabled(true);
          loop.setPaused(false);
          input.capturePointer();
        },
        onRestart: () => startMission({ seed: missionSeed }),
      });
    } else if (mode === 'paused') {
      mode = 'playing';
      screens.clear();
      input.setEnabled(true);
      loop.setPaused(false);
    }
  }

  // ------------------------------------------------------------- simulation

  /**
   * QA override. When set, simulation input comes from here instead of the
   * keyboard, so a browser test can drive a real playthrough deterministically.
   */
  let qaInput = null;

  function simStep(dt) {
    if (mode !== 'playing' || !world?.player) return;
    const edges = input.takeEdges();
    const axes = input.axes();
    const frameInput = qaInput ?? {
      axisX: axes.x,
      axisZ: axes.z,
      yaw: gameCamera.yaw,
      fire: input.firing,
      sprint: input.sprinting,
      dive: edges.dive,
      melee: edges.melee,
      relic: edges.relic,
      reload: edges.reload,
    };

    updatePlayer(world, world.player, control, frameInput, dt);

    if (runtime.ally?.downed) {
      const holdingInteract = qaInput ? !!qaInput.interact : input.interacting;
      reviveState = updateRevive(world, runtime.ally, world.player, holdingInteract, dt);
    } else {
      reviveState = { active: false, progress: 0 };
    }

    stepMission(world, runtime, dt, { focusId: control.lockTargetId });
  }

  // -------------------------------------------------------------- rendering

  function ensureView(entity) {
    if (views.has(entity.id)) return views.get(entity.id);
    const view = createActorView(entity.def, { quality: params.quality, team: entity.team });
    render.scene.add(view.group);
    views.set(entity.id, view);
    return view;
  }

  function renderFrame(dt) {
    const look = input.takeLook();
    if (mode === 'playing' && input.pointerLocked) {
      gameCamera.look(look.dx, look.dy);
      if (look.wheel) gameCamera.zoom(look.wheel);
    }

    if (world) {
      const player = world.player;
      const lock = control?.lockTargetId ? world.byId.get(control.lockTargetId) : null;
      gameCamera.update(dt, {
        targetPos: player ? player.pos : { x: 0, z: 0 },
        lockPos: lock?.alive ? lock.pos : null,
      });

      const ctx = { dt, time: loop.time, camera: render.camera };
      for (const entity of world.entities) {
        const view = ensureView(entity);
        view.update(entity, ctx);
      }
      vfx.update(dt, loop.time);
      render.lightRig.update(dt, loop.time);
      updateHud(dt);
    }

    render.render();
    frameMs = frameMs * 0.9 + dt * 1000 * 0.1;
  }

  function updateHud(dt) {
    hud.tick(dt);
    const player = world.player;
    if (!player) return;
    const status = playerStatus(world, player, control);
    const ally = runtime.ally;

    const activeEncounter = Object.values(runtime.encounters).find((e) => e.state === 'active');
    const objective = runtime.objectives.find((o) => o.state === 'active');

    let prompt = null;
    if (ally?.downed && dist(ally.pos, player.pos) <= 2.4) {
      const pct = Math.round(reviveState.progress * 100);
      prompt = `<b>E</b> Revive ${ally.name}${pct > 0 ? ` — ${pct}%` : ''}`;
    }

    hud.update({
      sector: MISSION.sector,
      objective: objective ? { text: objective.text, done: false } : null,
      encounter: activeEncounter
        ? {
            name: activeEncounter.def.name,
            remaining: activeEncounter.spawned.filter((e) => e.alive).length,
          }
        : null,
      hp: status.hp,
      maxHp: status.maxHp,
      posture: status.posture,
      maxPosture: status.maxPosture,
      mag: status.mag,
      reserve: status.reserve,
      relic: status.relic,
      inCover: status.inCover,
      staggered: status.staggered,
      statuses: player.statuses.map((s) => s.id),
      locked: !!status.lockTargetId,
      prompt,
      needsPointerLock: mode === 'playing' && !input.pointerLocked,
      squad: ally
        ? {
            name: ally.name,
            morale: ally.squad.morale,
            loyalty: ally.squad.loyalty,
            order: ally.squad.order,
            refusing: ally.squad.refusing,
            downed: ally.downed,
            lost: !ally.alive,
          }
        : null,
    });

    if (debugVisible) {
      const enemies = world.entities.filter((e) => e.kind === 'enemy' && e.alive);
      hud.debugText(
        [
          `seed ${world.seed}   t ${world.time.toFixed(1)}s   ${(1000 / Math.max(1, frameMs)).toFixed(0)} fps (${frameMs.toFixed(1)} ms)`,
          `draws ${render.renderer.info.render.calls}  tris ${render.renderer.info.render.triangles}  vfx ${JSON.stringify(vfx.stats())}`,
          `player pos ${player.pos.x.toFixed(1)},${player.pos.z.toFixed(1)}  cover ${player.inCover ? player.coverId : '-'}  action ${player.action?.moveId ?? '-'}`,
          `status ${runtime.status}  attunement ${world.flags.attunement}  kills ${world.flags.kills}`,
          ...enemies.map(
            (e) =>
              `  #${e.id} ${e.defId.padEnd(15)} ${(e.ai?.state ?? '-').padEnd(11)} hp ${Math.round(e.hp)
                .toString()
                .padStart(3)} ${e.action?.moveId ?? ''}${e.ai?.canCommit ? '' : ' [held]'}`,
          ),
        ].join('\n'),
      );
    }
  }

  // ----------------------------------------------------------------- events

  function wireEvents() {
    const on = bus.on;

    on('entity.spawned', (e) => {
      const entity = world.byId.get(e.id);
      if (entity) ensureView(entity);
    });

    on('shot.fired', (e) => {
      vfx.muzzle({ x: e.from.x, y: 1.3, z: e.from.z });
      const to = e.hit
        ? { x: e.to.x, y: 1.15, z: e.to.z }
        : {
            // a miss draws where the round actually went: past the target
            x: e.to.x + (Math.random() - 0.5) * 1.6,
            y: 1.15 + Math.random() * 0.7,
            z: e.to.z + (Math.random() - 0.5) * 1.6,
          };
      vfx.tracer({ x: e.from.x, y: 1.32, z: e.from.z }, to, e.hit ? '#ffd9a0' : '#c9c0a6');
      if (!e.hit) vfx.impact(to, 'dust');
    });

    on('entity.damaged', (e) => {
      const target = world.byId.get(e.id);
      if (!target) return;
      views.get(e.id)?.flashHit();
      vfx.impact({ x: target.pos.x, y: 1.1, z: target.pos.z }, target.kind === 'player' ? 'blood' : 'blood');
      if (e.sourceId === world.player?.id) hud.hitmarker();
      if (e.id === world.player?.id) gameCamera.shake(0.22 + e.amount * 0.004);
    });

    on('arc.swung', (e) => {
      const move = MOVES[e.moveId];
      if (move?.tags?.includes('relic')) {
        vfx.relicCone({ x: e.origin.x, z: e.origin.z }, e.dir, e.range, e.coneDeg);
        gameCamera.shake(0.18);
      }
    });

    on('projectile.spawned', (e) => {
      vfx.grenadeSpawned(e.projectileId, e.from, e.to, e.flightTime);
      if (e.ownerId !== world.player?.id) hud.toast('Grenade — move', 'danger');
    });
    on('projectile.landed', (e) => vfx.grenadeMarker(e.projectileId, e.pos, e.blastRadius, e.fuse));
    on('projectile.detonated', (e) => {
      vfx.clearMarker(e.projectileId);
      vfx.explosion(e.pos, e.blastRadius);
      const player = world.player;
      if (player) {
        const d = dist(player.pos, e.pos);
        gameCamera.shake(Math.max(0, 0.9 - d * 0.06));
      }
    });

    on('entity.staggered', (e) => {
      if (e.id === world.player?.id) {
        gameCamera.shake(0.4);
        hud.toast('Staggered', 'danger');
      }
    });

    on('relic.used', () => {
      hud.toast('Emberlash vented', 'arcane');
    });
    on('relic.charged', (e) => hud.toast(`Relic charge ${e.charges}`, 'arcane'));
    on('attunement.threshold', (e) => hud.toast(e.text, 'arcane'));

    on('squad.bark', (e) => hud.bark(e.speaker, e.line));
    on('squad.refused', () => hud.toast('She will not advance', 'danger'));
    on('ally.downed', (e) => hud.toast(`${e.name} is down`, 'danger'));
    on('ally.revived', () => hud.toast('Back on her feet', 'good'));
    on('ally.lost', (e) => hud.toast(`${e.name} did not make it`, 'danger'));

    on('objective.completed', (e) => hud.toast(e.text, 'good'));
    on('encounter.cleared', (e) => hud.toast(`${e.name} — clear`, 'good'));
    on('reward.granted', (e) => hud.toast(e.text, 'good'));
    on('gate.blocked', (e) => hud.bark('Cpl. Vela Ruhn', e.text));
    on('wave.spawned', () => gameCamera.shake(0.08));

    on('choice.presented', (e) => openChoice(e.choice));
    on('mission.complete', (e) => openDebrief(e));
    on('mission.failed', () => openDeath());
  }

  // ---------------------------------------------------------------- screens

  function openChoice(choice) {
    mode = 'choice';
    loop.setPaused(true);
    input.setEnabled(false);
    input.releasePointer();
    screens.choice({
      choice,
      onPick: (optionId) => {
        // Clear first: resolving can complete the mission synchronously and
        // mount the debrief, and clearing afterwards would wipe it.
        screens.clear();
        const option = resolveChoice(world, runtime, optionId);
        if (!option) {
          openChoice(choice);
          return;
        }
        if (option.resolves === 'encounter') {
          mode = 'playing';
          input.setEnabled(true);
          loop.setPaused(false);
          input.capturePointer();
        }
        // 'immediate' options complete the mission, which opens the debrief.
      },
    });
  }

  function openDebrief(payload) {
    mode = 'debrief';
    loop.setPaused(true);
    input.setEnabled(false);
    input.releasePointer();

    const option = runtime.resolvedChoice;
    // The choice's own attunement is recorded by recordChoice; this is the
    // attunement earned by actually firing the relic during the mission.
    const inMissionAttunement = world.flags.attunement - (option?.consequences.attunement ?? 0);
    const result = recordChoice(run, 'battery', option.id, option.consequences, bus);
    run.attunement += inMissionAttunement;

    const ally = runtime.ally;
    if (ally?.squad) {
      run.squad.morale = ally.squad.morale;
      run.squad.loyalty = ally.squad.loyalty;
      run.squad.velaLost = !ally.alive;
    }
    run.missionsCompleted.push(MISSION.id);
    run.seed = missionSeed;
    // Fixture runs are throwaway review states and must not overwrite a save.
    if (!params.fixture) saveRun(run);

    screens.debrief({
      option,
      result,
      run,
      stats: {
        kills: payload.kills,
        civiliansAlive: payload.civiliansAlive,
        attunement: run.attunement,
        ally: ally
          ? {
              name: ally.name,
              status: !ally.alive ? 'lost' : ally.downed ? 'wounded' : 'walking',
            }
          : null,
      },
      onContinue: () => showTitle(),
    });
  }

  function openDeath() {
    mode = 'dead';
    loop.setPaused(true);
    input.setEnabled(false);
    input.releasePointer();
    screens.death({
      onRetry: () => startMission({ seed: missionSeed }),
      onTitle: () => showTitle(),
    });
  }

  // ------------------------------------------------------------------- boot

  return {
    start() {
      loop.start();
      if (params.skipTitle) {
        startMission({ seed: params.seed, fixture: params.fixture });
      } else {
        showTitle();
      }
    },
    // exposed for browser-side QA and manual poking from the console
    debug: {
      get world() {
        return world;
      },
      get runtime() {
        return runtime;
      },
      get run() {
        return run;
      },
      get mode() {
        return mode;
      },
      startMission,
      vfx,
      render,
      camera: gameCamera,
      STEP,

      /** Drive input from a script instead of the keyboard. */
      setInput(next) {
        qaInput = next;
      },

      /**
       * Run `seconds` of simulation and draw one frame, without depending on
       * requestAnimationFrame. Lets automated browser QA reach a real, rendered
       * game state and read it back.
       */
      tick(seconds = 1, dt = STEP) {
        const steps = Math.max(1, Math.round(seconds / dt));
        // Render every step so view animations, VFX lifetimes and camera
        // smoothing advance exactly as they would in a live frame.
        for (let i = 0; i < steps; i++) {
          simStep(dt);
          renderFrame(dt);
        }
        return world?.time ?? 0;
      },

      /**
       * Simulation only, no drawing. Use for long scripted playthroughs where
       * rendering every step would block the main thread for minutes.
       */
      tickSim(seconds = 1, dt = STEP) {
        const steps = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < steps; i++) simStep(dt);
        return world?.time ?? 0;
      },

      /** Downscaled JPEG of the current frame, for visual regression checks. */
      frameDataUrl(width = 640, quality = 0.6) {
        renderFrame(1 / 60);
        const src = render.renderer.domElement;
        const scratch = document.createElement('canvas');
        scratch.width = width;
        scratch.height = Math.round((width * src.height) / src.width);
        scratch.getContext('2d').drawImage(src, 0, 0, scratch.width, scratch.height);
        return scratch.toDataURL('image/jpeg', quality);
      },
    },
  };
}
