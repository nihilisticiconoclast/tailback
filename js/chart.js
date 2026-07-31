/**
 * Observed cascade sizes against the Borel prediction.
 *
 * Bars are the empirical distribution over cascades that cleared. The line is
 * Borel(muEff), where muEff is mu below criticality and the dual parameter mu*q
 * above it, so the curve is always the correct conditional law.
 */

import { borelPmf } from './borel.js';

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const PAD = { top: 18, right: 14, bottom: 30, left: 46 };

export class Histogram {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.logScale = false;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  draw(sampler, muEff, nMax, liveSizes = []) {
    const ctx = this.ctx;
    const theme = {
      grid: css('--kerb'),
      chalk: css('--chalk'),
      faint: css('--chalk-faint'),
      dim: css('--chalk-dim'),
      observed: css('--observed'),
      theory: css('--theory'),
      live: css('--live'),
      mono: css('--font-mono'),
    };

    ctx.clearRect(0, 0, this.w, this.h);
    const plotW = this.w - PAD.left - PAD.right;
    const plotH = this.h - PAD.top - PAD.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const theory = new Float64Array(nMax + 1);
    let peak = 0;
    for (let n = 1; n <= nMax; n += 1) {
      theory[n] = borelPmf(n, muEff);
      if (theory[n] > peak) peak = theory[n];
    }

    const cleared = sampler.cleared;
    const empirical = new Float64Array(nMax + 1);
    for (let n = 1; n <= nMax; n += 1) {
      empirical[n] = cleared > 0 ? sampler.counts[n] / cleared : 0;
      if (empirical[n] > peak) peak = empirical[n];
    }

    const floor = this.logScale ? 1e-5 : 0;
    const top = this.logScale ? 1 : Math.max(peak * 1.12, 1e-6);
    const toY = (p) => {
      if (!this.logScale) return PAD.top + plotH * (1 - p / top);
      const clamped = Math.max(p, floor);
      const frac = (Math.log10(clamped) - Math.log10(floor)) / (0 - Math.log10(floor));
      return PAD.top + plotH * (1 - Math.min(1, Math.max(0, frac)));
    };
    const barW = plotW / nMax;
    const toX = (n) => PAD.left + (n - 1) * barW;

    // gridlines and y labels
    ctx.strokeStyle = theme.grid;
    ctx.fillStyle = theme.faint;
    ctx.font = `10px ${theme.mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const ticks = this.logScale ? [1, 0.1, 0.01, 0.001, 1e-4, 1e-5] : [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
    for (const t of ticks) {
      const y = Math.round(toY(t)) + 0.5;
      if (y < PAD.top - 1 || y > PAD.top + plotH + 1) continue;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
      const label = this.logScale ? t.toExponential(0).replace('e-0', 'e-') : t.toFixed(3);
      ctx.fillText(label, PAD.left - 8, y);
    }

    // empirical bars
    ctx.fillStyle = theme.observed;
    ctx.globalAlpha = 0.72;
    const base = PAD.top + plotH;
    for (let n = 1; n <= nMax; n += 1) {
      if (empirical[n] <= 0) continue;
      const y = toY(empirical[n]);
      ctx.fillRect(toX(n) + 0.5, y, Math.max(1, barW - 1.5), base - y);
    }
    ctx.globalAlpha = 1;

    // theoretical curve
    ctx.strokeStyle = theme.theory;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let n = 1; n <= nMax; n += 1) {
      const x = toX(n) + barW / 2;
      const y = toY(theory[n]);
      if (n === 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = theme.theory;
    for (let n = 1; n <= nMax; n += 1) {
      if (barW < 6 && n % 2 === 0) continue;
      ctx.beginPath();
      ctx.arc(toX(n) + barW / 2, toY(theory[n]), 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // x axis
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(PAD.left, base + 0.5);
    ctx.lineTo(PAD.left + plotW, base + 0.5);
    ctx.stroke();

    ctx.fillStyle = theme.faint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const stride = nMax <= 20 ? 2 : nMax <= 40 ? 5 : 10;
    for (let n = 1; n <= nMax; n += 1) {
      if (n !== 1 && n % stride !== 0) continue;
      ctx.fillText(String(n), toX(n) + barW / 2, base + 7);
    }
    ctx.textAlign = 'left';
    ctx.fillText('cars caught in cascade', PAD.left, base + 19);

    // the handful of cascades actually run on the circuit above
    if (liveSizes.length > 0) {
      ctx.strokeStyle = theme.live;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (const size of liveSizes) {
        if (size < 1 || size > nMax) continue;
        const x = Math.round(toX(size) + barW / 2) + 0.5;
        ctx.moveTo(x, base + 1);
        ctx.lineTo(x, base + 5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
