import { defaultParams, deriveMetrics, chartRange } from './model.js';
import { buildControls } from './controls.js';
import { CascadeSampler } from './queue.js';
import { mulberry32 } from './rng.js';
import { Circuit } from './circuit.js';
import { Histogram } from './chart.js';

const SAMPLES_PER_FRAME = 320;

const el = (id) => document.getElementById(id);

const params = defaultParams();
let metrics = deriveMetrics(params);

const circuit = new Circuit(el('circuit'));
const chart = new Histogram(el('histogram'));
const sampler = new CascadeSampler();

let seed = 20260731;
let statRand = mulberry32(seed);
let sceneRand = mulberry32(seed ^ 0x9e3779b9);
let running = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let last = performance.now();

circuit.populate(params.carCount, sceneRand);

const controls = buildControls(el('controls'), params, (key) => {
  metrics = deriveMetrics(params);
  if (key === 'carCount') circuit.setCount(params.carCount, sceneRand);
  if (key !== 'timeScale' && key !== 'triggerPerMin') sampler.reset();
  render();
});

function reseed(next) {
  seed = Number.isFinite(next) ? next : 0;
  statRand = mulberry32(seed);
  sceneRand = mulberry32(seed ^ 0x9e3779b9);
  sampler.reset();
  circuit.populate(params.carCount, sceneRand);
}

el('btn-play').addEventListener('click', (e) => {
  running = !running;
  e.currentTarget.setAttribute('aria-pressed', String(running));
  e.currentTarget.textContent = running ? 'Pause' : 'Run';
  last = performance.now();
});

el('btn-reset').addEventListener('click', () => {
  sampler.reset();
  render();
});

el('btn-log').addEventListener('click', (e) => {
  chart.logScale = !chart.logScale;
  e.currentTarget.setAttribute('aria-pressed', String(chart.logScale));
  render();
});

el('seed').addEventListener('change', (e) => {
  reseed(Number(e.currentTarget.value));
  render();
});

const onResize = () => {
  circuit.resize();
  chart.resize();
  render();
};
window.addEventListener('resize', onResize);

function fmt(x, digits = 2) {
  if (!Number.isFinite(x)) return '\u221e';
  return x.toFixed(digits);
}

function updateGantry() {
  el('m-flow').textContent = `${Math.round(metrics.flowPerHour)} veh/h`;
  el('m-density').textContent = `${fmt(metrics.densityPerKm, 1)} veh/km`;
  el('m-headway').textContent = `${fmt(metrics.headwaySec, 2)} s`;
  el('m-mu').textContent = fmt(metrics.mu, 3);

  const over = metrics.mu > 1;
  el('m-mu-block').classList.toggle('is-over', over);
  el('m-capacity').classList.toggle('is-over', over);
  el('m-capacity-fill').style.width = `${Math.min(100, (metrics.mu / 1.5) * 100)}%`;

  el('m-mean').textContent = Number.isFinite(metrics.clearedMean)
    ? `${fmt(metrics.clearedMean, 2)} cars`
    : '\u221e';

  el('m-clears').textContent =
    metrics.q >= 1 ? 'always' : `${fmt(metrics.q * 100, 1)}% of the time`;
}

function updateStatus() {
  const jam = circuit.jam;
  if (jam) {
    el('stage-status').textContent = `cascade running \u2014 ${jam.served} of ${jam.target} released`;
  } else if (circuit.lastCascade) {
    el('stage-status').textContent = `last cascade ${circuit.lastCascade.size} cars \u2014 waiting`;
  } else {
    el('stage-status').textContent = 'waiting for a braking event';
  }

  const n = sampler.cleared;
  const empiricalMean = sampler.mean;
  const parts = [`n = ${n.toLocaleString('en-GB')}`];
  if (n > 0) parts.push(`mean ${fmt(empiricalMean, 2)}`);
  if (Number.isFinite(metrics.clearedMean)) parts.push(`vs ${fmt(metrics.clearedMean, 2)}`);
  if (sampler.stalled > 0) parts.push(`${sampler.stalled.toLocaleString('en-GB')} never cleared`);
  el('chart-status').textContent = parts.join('  \u00b7  ');
}

function render() {
  updateGantry();
  circuit.draw();
  chart.draw(sampler, metrics.muEff, chartRange(metrics));
  updateStatus();
}

function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (running) {
    sampler.drawBatch(metrics.mu, statRand, SAMPLES_PER_FRAME);
    circuit.step(rawDt * params.timeScale, metrics, params, sceneRand);
    render();
  }

  requestAnimationFrame(frame);
}

controls.sync(params);
render();
requestAnimationFrame(frame);

if (!running) {
  el('btn-play').setAttribute('aria-pressed', 'false');
  el('btn-play').textContent = 'Run';
}
