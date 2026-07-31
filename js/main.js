import { defaultParams, deriveMetrics, chartRange } from './model.js';
import { buildControls } from './controls.js';
import { CascadeSampler } from './queue.js';
import { mulberry32 } from './rng.js';
import { Circuit } from './circuit.js';
import { Histogram } from './chart.js';

/** How many recent circuit cascades to mark on the histogram. */
const LIVE_KEEP = 60;

const el = (id) => document.getElementById(id);

const params = defaultParams();
let metrics = deriveMetrics(params);

const circuit = new Circuit(el('circuit'));
const chart = new Histogram(el('histogram'));
const sampler = new CascadeSampler();

/**
 * Cascades actually run on the circuit, kept apart from the fast sampler. There
 * are only ever a handful of these, but they are the ones the eye followed, so
 * they are worth showing next to the law they are supposed to obey.
 */
const live = { count: 0, sum: 0, stalled: 0, sizes: [] };

function resetLive() {
  live.count = 0;
  live.sum = 0;
  live.stalled = 0;
  live.sizes.length = 0;
}

function recordLive(cascade) {
  if (!cascade.cleared) {
    live.stalled += 1;
    return;
  }
  live.count += 1;
  live.sum += cascade.size;
  live.sizes.push(cascade.size);
  if (live.sizes.length > LIVE_KEEP) live.sizes.shift();
}

let seed = 20260731;
let statRand = mulberry32(seed);
let sceneRand = mulberry32(seed ^ 0x9e3779b9);
let running = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let last = performance.now();

circuit.populate(params.carCount, sceneRand);

const controls = buildControls(el('controls'), params, (key) => {
  metrics = deriveMetrics(params);
  if (key === 'carCount') circuit.setCount(params.carCount, sceneRand);
  // Anything that moves mu invalidates both populations of samples.
  if (key !== 'timeScale' && key !== 'triggerPerMin') {
    sampler.reset();
    resetLive();
  }
  render();
});

function reseed(next) {
  seed = Number.isFinite(next) ? next : 0;
  statRand = mulberry32(seed);
  sceneRand = mulberry32(seed ^ 0x9e3779b9);
  sampler.reset();
  resetLive();
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
  resetLive();
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
  if (!Number.isFinite(x)) return '∞';
  return x.toFixed(digits);
}

function updateGantry() {
  el('m-flow').textContent = `${fmt(metrics.flowPerSec, 2)} /s`;
  el('m-density').textContent = `${fmt(metrics.densityPerKm, 1)} veh/km`;
  el('m-headway').textContent = `${fmt(metrics.headwaySec, 2)} s`;
  el('m-mu').textContent = fmt(metrics.mu, 3);

  const over = metrics.mu > 1;
  el('m-mu-block').classList.toggle('is-over', over);
  el('m-capacity').classList.toggle('is-over', over);
  el('m-capacity-fill').style.width = `${Math.min(100, (metrics.mu / 1.5) * 100)}%`;
  el('m-regime').textContent =
    metrics.regime === 'subcritical'
      ? 'subcritical — cascades die out'
      : metrics.regime === 'critical'
        ? 'critical — ends, but mean is infinite'
        : 'supercritical — some never end';

  el('m-mean').textContent = Number.isFinite(metrics.clearedMean)
    ? `${fmt(metrics.clearedMean, 2)} cars`
    : '∞';

  el('m-clears').textContent =
    metrics.q >= 1 ? 'always' : `${fmt(metrics.q * 100, 1)}% of the time`;
}

function updateStatus() {
  const st = circuit.status;
  if (st.running) {
    el('stage-status').textContent =
      `cascade running — ${st.nodes} caught, ${st.served} cleared, ${st.stopped} still to clear`;
  } else if (st.last) {
    el('stage-status').textContent = st.last.cleared
      ? `last cascade ${st.last.size} cars — waiting`
      : `last cascade never cleared — still growing at ${st.last.size} cars`;
  } else {
    el('stage-status').textContent = 'waiting for a braking event';
  }

  if (live.count === 0 && live.stalled === 0) {
    el('live-tally').textContent =
      'The circuit has not finished a cascade yet. Each one it completes is counted here and ticked under the histogram below.';
  } else {
    const target = Number.isFinite(metrics.clearedMean) ? fmt(metrics.clearedMean, 2) : '∞';
    const bits = [`Cascades run here: ${live.count.toLocaleString('en-GB')}`];
    if (live.count > 0) bits.push(`mean ${fmt(live.sum / live.count, 2)} cars`);
    bits.push(`Borel says ${target}`);
    if (live.stalled > 0) bits.push(`${live.stalled} never cleared`);
    el('live-tally').textContent =
      `${bits.join('  ·  ')}. A handful of cascades is a tiny sample of a very` +
      ' long-tailed law, so expect this to wander. The histogram below is the same' +
      ' rule sampled millions of times.';
  }

  const n = sampler.cleared;
  const parts = [`n = ${n.toLocaleString('en-GB')}`];
  if (n > 0) parts.push(`mean ${fmt(sampler.mean, 2)}`);
  if (Number.isFinite(metrics.clearedMean)) parts.push(`vs ${fmt(metrics.clearedMean, 2)}`);
  if (sampler.stalled > 0) parts.push(`${sampler.stalled.toLocaleString('en-GB')} never cleared`);
  el('chart-status').textContent = parts.join('  ·  ');
}

function render() {
  updateGantry();
  circuit.draw();
  chart.draw(sampler, metrics.muEff, chartRange(metrics), live.sizes);
  updateStatus();
}

function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (running) {
    // Bounded by work rather than sample count, so a supercritical mu slows the
    // fill instead of freezing the frame.
    sampler.drawBatch(metrics.mu, statRand);
    circuit.step(rawDt * params.timeScale, metrics, params, sceneRand, recordLive);
    render();
  }

  requestAnimationFrame(frame);
}

controls.sync(params);
render();
requestAnimationFrame(frame);

// The canvases set their label font from --font-mono, which is a webfont. The
// first draw can land before it arrives, and a paused page would keep the
// fallback indefinitely, so redraw once it is ready.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(render);
}

if (!running) {
  el('btn-play').setAttribute('aria-pressed', 'false');
  el('btn-play').textContent = 'Run';
}
