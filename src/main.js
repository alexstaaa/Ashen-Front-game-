import './style.css';
import { createGame } from './game.js';
import { readParams } from './debug/fixtures.js';

const params = readParams();
const game = createGame({
  canvas: document.getElementById('viewport'),
  hudEl: document.getElementById('hud'),
  screensEl: document.getElementById('screens'),
  params,
});

game.start();

// Handy for browser QA: window.ashen.world, window.ashen.startMission({fixture:'choice'})
window.ashen = game.debug;
