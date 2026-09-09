/**
 * HUD. A pure consumer of simulation state: it renders what the sim already
 * decided and never asks it a question. Every meaningful action has a
 * screen-visible response here — that is the contract this file exists for.
 */

const TEMPLATE = `
  <div class="hud-corner hud-tl">
    <div class="label" data-el="sector"></div>
    <div class="objective" data-el="objective"></div>
  </div>

  <div class="hud-corner hud-tr">
    <div class="label" data-el="encounter-label"></div>
    <div class="objective" data-el="encounter"></div>
  </div>

  <div class="hud-corner hud-bl">
    <div class="label">Condition</div>
    <div class="bar hp"><i data-el="hp"></i></div>
    <div class="bar posture"><i data-el="posture"></i></div>
    <div class="chips" data-el="chips"></div>
  </div>

  <div class="hud-corner hud-bc">
    <div class="ammo" data-el="ammo"></div>
    <div class="relic" data-el="relic"></div>
  </div>

  <div class="hud-corner hud-br">
    <div class="squad-name" data-el="squad-name"></div>
    <div class="squad-row"><span>Morale</span><span class="bar morale" style="width:110px"><i data-el="morale"></i></span></div>
    <div class="squad-row"><span>Loyalty</span><span class="bar loyalty" style="width:110px"><i data-el="loyalty"></i></span></div>
    <div class="orders" data-el="orders"></div>
  </div>

  <div class="reticle" data-el="reticle"></div>
  <div class="hitmarker" data-el="hitmarker"></div>
  <div class="vignette" data-el="vignette"></div>
  <div class="toast-rail" data-el="toasts"></div>
  <div class="subtitles hidden" data-el="subtitles"></div>
  <div class="prompt hidden" data-el="prompt"></div>
  <div class="mouse-hint hidden" data-el="mousehint">Click to capture the mouse</div>
  <div class="debug hidden" data-el="debug"></div>
`;

const ORDER_KEYS = [
  { id: 'hold', key: '1', label: 'Hold' },
  { id: 'advance', key: '2', label: 'Advance' },
  { id: 'focus', key: '3', label: 'Focus' },
];

export function createHud(rootEl) {
  rootEl.innerHTML = TEMPLATE;
  const el = {};
  for (const node of rootEl.querySelectorAll('[data-el]')) el[node.dataset.el] = node;

  el.orders.innerHTML = ORDER_KEYS.map(
    (o) => `<span class="order" data-order="${o.id}">${o.key} ${o.label}</span>`,
  ).join('');

  let barkTimer = 0;
  let hitTimer = 0;
  const toasts = [];

  const setScale = (node, frac) => {
    node.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  };

  const api = {
    update(s) {
      el.sector.textContent = s.sector ?? '';
      el.objective.textContent = s.objective?.text ?? '';
      el.objective.classList.toggle('done', !!s.objective?.done);

      el['encounter-label'].textContent = s.encounter ? 'Contact' : '';
      el.encounter.textContent = s.encounter
        ? `${s.encounter.name} — ${s.encounter.remaining} left`
        : '';

      setScale(el.hp, s.hp / s.maxHp);
      setScale(el.posture, s.posture / s.maxPosture);

      const chips = [];
      if (s.inCover) chips.push(['cover', 'In cover']);
      if (s.staggered) chips.push(['stagger', 'Staggered']);
      for (const st of s.statuses ?? []) {
        if (st === 'suppressed') chips.push(['suppressed', 'Suppressed']);
        if (st === 'burning') chips.push(['burning', 'Burning']);
      }
      el.chips.innerHTML = chips.map(([c, t]) => `<span class="chip ${c}">${t}</span>`).join('');

      const empty = s.mag <= 0;
      el.ammo.className = `ammo${empty ? ' empty' : ''}`;
      el.ammo.innerHTML = `${s.mag}<small>/ ${s.reserve}</small>`;

      if (s.relic) {
        const cells = [];
        for (let i = 0; i < s.relic.max; i++) {
          cells.push(`<i class="${i < s.relic.charges ? 'on' : ''}"></i>`);
        }
        el.relic.innerHTML = cells.join('');
      }

      if (s.squad) {
        el['squad-name'].textContent = s.squad.downed
          ? `${s.squad.name} — DOWN`
          : s.squad.lost
            ? `${s.squad.name} — LOST`
            : s.squad.name;
        setScale(el.morale, s.squad.morale / 100);
        setScale(el.loyalty, s.squad.loyalty / 100);
        for (const node of el.orders.children) {
          node.classList.toggle('active', node.dataset.order === s.squad.order);
          node.classList.toggle('refused', !!s.squad.refusing && node.dataset.order === 'advance');
        }
      }

      el.reticle.classList.toggle('locked', !!s.locked);
      el.vignette.style.opacity = String(Math.max(0, 1 - s.hp / (s.maxHp * 0.45)) * 0.9);

      if (s.prompt) {
        el.prompt.classList.remove('hidden');
        el.prompt.innerHTML = s.prompt;
      } else {
        el.prompt.classList.add('hidden');
      }

      // Without pointer lock the mouse does nothing; say so rather than
      // letting it read as broken controls.
      el.mousehint.classList.toggle('hidden', !s.needsPointerLock);
    },

    tick(dt) {
      if (barkTimer > 0) {
        barkTimer -= dt;
        if (barkTimer <= 0) el.subtitles.classList.add('hidden');
      }
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) el.hitmarker.classList.remove('show');
      }
      for (let i = toasts.length - 1; i >= 0; i--) {
        toasts[i].t -= dt;
        if (toasts[i].t <= 0) {
          toasts[i].node.remove();
          toasts.splice(i, 1);
        }
      }
    },

    toast(text, kind = '') {
      const node = document.createElement('div');
      node.className = `toast ${kind}`.trim();
      node.textContent = text;
      el.toasts.appendChild(node);
      toasts.push({ node, t: 3.2 });
      while (toasts.length > 4) {
        toasts.shift().node.remove();
      }
    },

    bark(speaker, line) {
      el.subtitles.classList.remove('hidden');
      el.subtitles.innerHTML = `<span class="who">${speaker}</span>${line}`;
      barkTimer = 4.0;
    },

    hitmarker() {
      el.hitmarker.classList.remove('show');
      // reflow so the animation restarts on rapid consecutive hits
      void el.hitmarker.offsetWidth;
      el.hitmarker.classList.add('show');
      hitTimer = 0.25;
    },

    setDebug(visible) {
      el.debug.classList.toggle('hidden', !visible);
    },

    debugText(text) {
      if (!el.debug.classList.contains('hidden')) el.debug.textContent = text;
    },

    setVisible(visible) {
      rootEl.style.display = visible ? '' : 'none';
    },
  };

  return api;
}
