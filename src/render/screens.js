/**
 * Full-screen states: title, brief, the decision, pause, death and debrief.
 * Screens are dumb views — they render what they are handed and report the
 * player's click back through a callback.
 */
import { FACTIONS } from '../content/factions.js';
import { repSummary, warfrontSummary } from '../sim/consequences.js';

const CONTROLS = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look / aim'],
  ['Left click', 'Fire'],
  ['R', 'Reload'],
  ['Space', 'Dive (brief invulnerability)'],
  ['F', 'Bayonet'],
  ['Q', 'Emberlash relic'],
  ['Tab', 'Lock on / release'],
  ['1 2 3', 'Squad: hold / advance / focus'],
  ['E', 'Interact — hold to revive'],
  ['Shift', 'Sprint'],
  ['Esc', 'Pause'],
  ['F3', 'Debug overlay'],
];

export function createScreens(rootEl) {
  let current = null;

  function mount(html, wire) {
    rootEl.innerHTML = `<div class="screen">${html}</div>`;
    const screen = rootEl.firstElementChild;
    wire?.(screen);
    current = screen;
    const focusable = screen.querySelector('button');
    focusable?.focus();
    return screen;
  }

  function clear() {
    rootEl.innerHTML = '';
    current = null;
  }

  return {
    get isOpen() {
      return !!current;
    },
    clear,

    title({ hasSave, onStart, onContinue }) {
      mount(
        `<div class="panel">
          <div class="eyebrow">Vertical slice — Vaunt Salient</div>
          <h1>Ashen&nbsp;Front</h1>
          <p style="max-width:60ch">
            A deserter, a corporal who has not decided about you yet, and a battery that will
            not stop firing until somebody pays for it.
          </p>
          <div class="rule"></div>
          <h2>Controls</h2>
          <div class="controls">
            ${CONTROLS.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join('')}
          </div>
          <div class="btn-row">
            <button class="btn" data-act="start">Begin mission</button>
            ${hasSave ? '<button class="btn ghost" data-act="continue">Continue run</button>' : ''}
          </div>
        </div>`,
        (screen) => {
          screen.querySelector('[data-act="start"]').onclick = onStart;
          const cont = screen.querySelector('[data-act="continue"]');
          if (cont) cont.onclick = onContinue;
        },
      );
    },

    brief({ mission, run, onDeploy }) {
      const rep = repSummary(run);
      mount(
        `<div class="panel">
          <div class="eyebrow">${mission.sector}</div>
          <h1 style="font-size:clamp(26px,4vw,40px)">${mission.name}</h1>
          <div class="rule"></div>
          ${mission.brief.map((p) => `<p>${p}</p>`).join('')}
          <div class="rule"></div>
          <h2>Standing</h2>
          <div>${rep.map(repRow).join('')}</div>
          <div class="btn-row"><button class="btn" data-act="go">Cross the wire</button></div>
        </div>`,
        (screen) => {
          screen.querySelector('[data-act="go"]').onclick = onDeploy;
        },
      );
    },

    choice({ choice, onPick }) {
      mount(
        `<div class="panel">
          <div class="eyebrow">Decision</div>
          <h1 style="font-size:clamp(22px,3.2vw,32px)">${choice.prompt}</h1>
          <p>${choice.detail}</p>
          <div class="choices">
            ${choice.options
              .map(
                (o) => `
              <button class="choice ${o.available ? '' : 'locked'}" data-option="${o.id}" ${
                o.available ? '' : 'disabled'
              }>
                <div class="title">${o.label}</div>
                <div class="sub">${o.summary}</div>
                ${o.requiresText ? `<div class="req">${o.requiresText}${o.available ? '' : ' — unavailable'}</div>` : ''}
              </button>`,
              )
              .join('')}
          </div>
        </div>`,
        (screen) => {
          for (const btn of screen.querySelectorAll('.choice')) {
            btn.onclick = () => onPick(btn.dataset.option);
          }
        },
      );
    },

    pause({ onResume, onRestart }) {
      mount(
        `<div class="panel" style="max-width:520px">
          <div class="eyebrow">Paused</div>
          <h1 style="font-size:34px">Hold</h1>
          <div class="rule"></div>
          <div class="controls">${CONTROLS.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join('')}</div>
          <div class="btn-row">
            <button class="btn" data-act="resume">Resume</button>
            <button class="btn ghost" data-act="restart">Restart mission</button>
          </div>
        </div>`,
        (screen) => {
          screen.querySelector('[data-act="resume"]').onclick = onResume;
          screen.querySelector('[data-act="restart"]').onclick = onRestart;
        },
      );
    },

    death({ onRetry, onTitle }) {
      mount(
        `<div class="panel" style="max-width:520px">
          <div class="eyebrow">Killed in the salient</div>
          <h1 style="font-size:34px">No further orders</h1>
          <p>The Coalition will write that the deserter did not make the wire. The battery keeps firing.</p>
          <div class="btn-row">
            <button class="btn" data-act="retry">Try again</button>
            <button class="btn ghost" data-act="title">Back to title</button>
          </div>
        </div>`,
        (screen) => {
          screen.querySelector('[data-act="retry"]').onclick = onRetry;
          screen.querySelector('[data-act="title"]').onclick = onTitle;
        },
      );
    },

    /**
     * Debrief. The frontline bar and reputation tracks animate from their
     * previous values so the player sees the consequence move, not just land.
     */
    debrief({ option, result, run, stats, onContinue }) {
      const front = warfrontSummary(run);
      const rep = repSummary(run);
      const beforeRep = result.repBefore;

      mount(
        `<div class="panel">
          <div class="eyebrow">Debrief — ${run.warfrontLabel}</div>
          <h1 style="font-size:clamp(24px,3.4vw,36px)">${option.label}</h1>
          <div class="rule"></div>
          <div class="epilogue">
            ${option.epilogue}
            ${option.velaLine ? `<span class="said">“${option.velaLine}” — Cpl. Vela Ruhn</span>` : ''}
          </div>
          <div class="rule"></div>
          <div class="debrief-grid">
            <div>
              <h2>Frontline</h2>
              <div class="front-track">
                <div class="held" data-el="held" style="width:${clampPct(beforeFront(run, result))}%"></div>
                <div class="line" data-el="line" style="left:${clampPct(beforeFront(run, result))}%"></div>
              </div>
              <div class="front-legend"><span>Kaldreich ${Math.round(front.kald)}%</span><span>${front.posture}</span><span>Coalition ${Math.round(front.coalition)}%</span></div>
              <h2 style="margin-top:22px">Mission</h2>
              <div class="stat-list">
                Enemies down <b>${stats.kills}</b><br/>
                Civilians alive <b>${stats.civiliansAlive}</b><br/>
                Relic attunement <b>${stats.attunement}</b><br/>
                ${stats.ally ? `${stats.ally.name} <b>${stats.ally.status}</b>` : ''}
              </div>
            </div>
            <div>
              <h2>Standing</h2>
              ${rep.map((r) => repRow(r, beforeRep[r.id])).join('')}
              <h2 style="margin-top:22px">Squad</h2>
              <div class="stat-list">
                Morale <b>${Math.round(run.squad.morale)}</b> · Loyalty <b>${Math.round(run.squad.loyalty)}</b>
              </div>
            </div>
          </div>
          <div class="btn-row"><button class="btn" data-act="continue">Hold the line</button></div>
        </div>`,
        (screen) => {
          screen.querySelector('[data-act="continue"]').onclick = onContinue;

          // Let the pre-change values paint, then animate to the new state.
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            screen.querySelector('[data-el="held"]').style.width = `${clampPct(front.kald)}%`;
            screen.querySelector('[data-el="line"]').style.left = `${clampPct(front.kald)}%`;
            for (const track of screen.querySelectorAll('[data-rep]')) {
              Object.assign(track.style, repFillStyle(Number(track.dataset.rep)));
            }
          };
          requestAnimationFrame(() => requestAnimationFrame(settle));
          // Backstop: in a hidden or throttled tab rAF may never fire, and the
          // debrief must still end up showing the true numbers.
          setTimeout(settle, 250);
        },
      );
    },
  };
}

function beforeFront(run, result) {
  return run.warfront + (result.territory ?? 0);
}

const clampPct = (v) => Math.max(0, Math.min(100, v));

function repFillStyle(value) {
  const half = Math.abs(value) / 2;
  return value >= 0
    ? { left: '50%', width: `${half}%` }
    : { left: `${50 - half}%`, width: `${half}%` };
}

function repRow(r, before) {
  const start = before ?? r.value;
  const delta = Math.round(r.value - start);
  const startStyle = repFillStyle(start);
  const deltaLabel =
    delta === 0 ? '' : `<span class="rep-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</span>`;
  return `
    <div class="rep-row">
      <div class="rep-head">
        <span>${FACTIONS[r.id].name}</span>
        <span>${r.tier} ${deltaLabel}</span>
      </div>
      <div class="rep-track">
        <div class="mid"></div>
        <div class="fill" data-rep="${r.value}" style="left:${startStyle.left};width:${startStyle.width};background:${r.color}"></div>
      </div>
    </div>`;
}
