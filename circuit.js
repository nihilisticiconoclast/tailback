/**
 * The circuit stage.
 *
 * Draws a closed stadium-shaped loop, cars moving round it at constant speed,
 * a fixed disturbance point, and the tailback that forms behind it. Inside the
 * loop it draws the Galton-Watson tree of the cascade currently on screen: one
 * node per car caught, lit as that car is released.
 *
 * The circuit stages a cascade drawn from the sampler rather than deriving one
 * from car-following dynamics. See MODEL.md, "What the circuit is and isn't".
 */

import { sampleCascadeTree } from './queue.js';

const CAR_LENGTH = 11;
const CAR_WIDTH = 6;
const QUEUE_PITCH = 13.5;
const ROAD_WIDTH = 26;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Tidy-tree layout: x by generation, y by leaf order, parents centred on children. */
function layoutTree(tree) {
  const n = tree.size;
  const children = Array.from({ length: n }, () => []);
  for (let i = 1; i < n; i += 1) children[tree.parent[i]].push(i);

  const y = new Float64Array(n);
  let slot = 0;
  const stack = [[0, false]];
  while (stack.length) {
    const [node, expanded] = stack.pop();
    if (expanded) {
      const kids = children[node];
      if (kids.length === 0) {
        y[node] = slot;
        slot += 1;
      } else {
        y[node] = (y[kids[0]] + y[kids[kids.length - 1]]) / 2;
      }
    } else {
      stack.push([node, true]);
      const kids = children[node];
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push([kids[i], false]);
    }
  }
  return { children, y, leaves: Math.max(1, slot) };
}

export class Circuit {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cars = [];
    this.jam = null;
    this.triggerClock = 0;
    this.lastCascade = null;
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

    const margin = 38;
    const r = Math.max(40, (this.h - 2 * margin) / 2);
    // Cap the straights so a wide panel gives a circuit rather than a hairpin,
    // and so the infield stays tall enough to hold the cascade tree.
    const a = Math.min(2.2 * r, Math.max(20, this.w - 2 * margin - 2 * r));
    this.geom = { a, r, cx: this.w / 2, cy: this.h / 2 };
    this.perimeter = 2 * a + 2 * Math.PI * r;
    this.stopLine = a * 0.62;
    this.buildPath();
  }

  buildPath() {
    const steps = 480;
    this.outline = new Path2D();
    for (let i = 0; i <= steps; i += 1) {
      const { x, y } = this.pointAt((i / steps) * this.perimeter);
      if (i === 0) this.outline.moveTo(x, y);
      else this.outline.lineTo(x, y);
    }
    this.outline.closePath();
  }

  /** Arclength parametrisation of the stadium, running anticlockwise on screen. */
  pointAt(s) {
    const { a, r, cx, cy } = this.geom;
    const arc = Math.PI * r;
    let t = ((s % this.perimeter) + this.perimeter) % this.perimeter;

    if (t < a) return { x: cx - a / 2 + t, y: cy + r };
    t -= a;
    if (t < arc) {
      const th = t / r;
      return { x: cx + a / 2 + r * Math.sin(th), y: cy + r * Math.cos(th) };
    }
    t -= arc;
    if (t < a) return { x: cx + a / 2 - t, y: cy - r };
    t -= a;
    const th = t / r;
    return { x: cx - a / 2 - r * Math.sin(th), y: cy - r * Math.cos(th) };
  }

  headingAt(s) {
    const p = this.pointAt(s);
    const nxt = this.pointAt(s + 1.2);
    return Math.atan2(nxt.y - p.y, nxt.x - p.x);
  }

  /** Forward distance from s to the stop line. */
  distanceToStop(s) {
    return ((this.stopLine - s) % this.perimeter + this.perimeter) % this.perimeter;
  }

  populate(count, rand) {
    this.cars = [];
    for (let i = 0; i < count; i += 1) {
      this.cars.push({ s: rand() * this.perimeter, state: 'cruise', released: 0 });
    }
    this.jam = null;
    this.queue = [];
  }

  setCount(count, rand) {
    while (this.cars.length > count) this.cars.pop();
    while (this.cars.length < count) {
      this.cars.push({ s: rand() * this.perimeter, state: 'cruise', released: 0 });
    }
    this.queue = (this.queue || []).filter((c) => this.cars.includes(c));
  }

  step(dt, metrics, params, rand, onCascadeComplete) {
    const pxPerMetre = this.perimeter / metrics.circuitM;
    const speedPx = metrics.speedMps * pxPerMetre;
    const pitch = Math.max(QUEUE_PITCH, 7 * pxPerMetre);
    this.queue = this.queue || [];

    if (!this.jam) {
      this.triggerClock += dt * (params.triggerPerMin / 60);
      if (this.triggerClock >= 1) {
        this.triggerClock = 0;
        const tree = sampleCascadeTree(metrics.mu, rand);
        this.jam = {
          tree,
          layout: layoutTree(tree),
          target: tree.size,
          served: 0,
          serviceClock: 0,
        };
      }
    }

    const jamOpen = this.jam !== null && this.jam.served < this.jam.target;

    for (const car of this.cars) {
      if (car.state === 'queued') continue;
      car.s = (car.s + speedPx * dt) % this.perimeter;
      if (car.released > 0) car.released = Math.max(0, car.released - dt);
      if (jamOpen) {
        const d = this.distanceToStop(car.s);
        const zone = Math.max(pitch * 0.5, this.queue.length * pitch);
        if (d <= zone && car.released === 0) {
          car.state = 'queued';
          this.queue.push(car);
        }
      }
    }

    if (this.jam) {
      const serviceRate = 1 / Math.max(0.05, params.clearSec);
      this.jam.serviceClock += dt * serviceRate;
      while (this.jam.serviceClock >= 1 && this.queue.length > 0 && this.jam.served < this.jam.target) {
        this.jam.serviceClock -= 1;
        const front = this.queue.shift();
        front.state = 'cruise';
        front.released = 1.6;
        front.s = (this.stopLine + 3) % this.perimeter;
        this.jam.served += 1;
      }
      if (this.jam.served >= this.jam.target) {
        for (const car of this.queue) {
          car.state = 'cruise';
          car.released = 1.2;
        }
        this.queue = [];
        this.lastCascade = { size: this.jam.target, truncated: this.jam.tree.truncated };
        this.faded = { ...this.jam, served: this.jam.target };
        if (onCascadeComplete) onCascadeComplete(this.lastCascade);
        this.jam = null;
      }
    }

    let k = 0;
    for (const car of this.queue) {
      car.s = ((this.stopLine - k * pitch) % this.perimeter + this.perimeter) % this.perimeter;
      k += 1;
    }
  }

  draw() {
    const ctx = this.ctx;
    const theme = {
      road: css('--road'),
      kerb: css('--kerb'),
      chalk: css('--chalk'),
      chalkFaint: css('--chalk-faint'),
      flow: css('--flow'),
      brake: css('--brake'),
      amber: css('--amber'),
    };

    ctx.clearRect(0, 0, this.w, this.h);

    ctx.lineCap = 'butt';
    ctx.strokeStyle = theme.road;
    ctx.lineWidth = ROAD_WIDTH;
    ctx.stroke(this.outline);

    ctx.strokeStyle = theme.kerb;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke(this.outline);

    ctx.strokeStyle = theme.chalkFaint;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([9, 15]);
    ctx.stroke(this.outline);
    ctx.setLineDash([]);

    this.drawStopLine(ctx, theme);
    if (this.jam) this.drawTree(ctx, theme, 1);
    else if (this.faded) this.drawTree(ctx, theme, 0.32, this.faded);

    for (const car of this.cars) this.drawCar(ctx, car, theme);
  }

  drawStopLine(ctx, theme) {
    const p = this.pointAt(this.stopLine);
    const th = this.headingAt(this.stopLine);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(th);
    ctx.strokeStyle = this.jam ? theme.brake : theme.chalkFaint;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -ROAD_WIDTH / 2);
    ctx.lineTo(0, ROAD_WIDTH / 2);
    ctx.stroke();
    ctx.fillStyle = this.jam ? theme.brake : theme.chalkFaint;
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DISTURBANCE', 0, ROAD_WIDTH / 2 + 13);
    ctx.restore();
  }

  drawCar(ctx, car, theme) {
    const p = this.pointAt(car.s);
    const th = this.headingAt(car.s);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(th);
    if (car.state === 'queued') {
      ctx.fillStyle = theme.brake;
      ctx.shadowColor = theme.brake;
      ctx.shadowBlur = 7;
    } else if (car.released > 0) {
      ctx.fillStyle = theme.amber;
      ctx.globalAlpha = 0.35 + 0.45 * (car.released / 1.6);
    } else {
      ctx.fillStyle = theme.flow;
      ctx.globalAlpha = 0.85;
    }
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 1.5);
    } else {
      ctx.rect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH);
    }
    ctx.fill();
    ctx.restore();
  }

  /** The signature: the branching process itself, drawn in the infield. */
  drawTree(ctx, theme, alpha = 1, source = null) {
    const { tree, layout, served } = source || this.jam;
    const { a, r, cx, cy } = this.geom;
    const boxW = a + r * 0.7;
    const boxH = 2 * r * 0.58;
    const x0 = cx - boxW / 2;
    const y0 = cy - boxH / 2;

    const cols = Math.max(1, tree.depth);
    const rows = Math.max(1, layout.leaves - 1);
    const px = (i) => x0 + (tree.generation[i] / cols) * boxW;
    const py = (i) => y0 + (layout.y[i] / rows) * boxH;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.amber;
    const dense = tree.size > 120;
    ctx.globalAlpha = (dense ? 0.13 : 0.22) * alpha;
    ctx.beginPath();
    for (let i = 1; i < tree.size; i += 1) {
      const parent = tree.parent[i];
      const xa = px(parent);
      const ya = py(parent);
      const xb = px(i);
      const yb = py(i);
      const mid = (xa + xb) / 2;
      ctx.moveTo(xa, ya);
      ctx.bezierCurveTo(mid, ya, mid, yb, xb, yb);
    }
    ctx.stroke();

    const nodeR = tree.size > 240 ? 1.1 : tree.size > 80 ? 1.4 : 1.7;
    for (let i = 0; i < tree.size; i += 1) {
      const lit = i < served;
      ctx.globalAlpha = (lit ? 0.95 : 0.28) * alpha;
      ctx.fillStyle = lit ? theme.brake : theme.amber;
      ctx.beginPath();
      ctx.arc(px(i), py(i), nodeR * (lit ? 1.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.chalkFaint;
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    const label = tree.truncated
      ? `CASCADE ${served} / >${tree.size}  DEPTH ${tree.depth}`
      : `CASCADE ${served} / ${tree.size}  DEPTH ${tree.depth}`;
    ctx.fillText(label, x0, y0 - 12);
    ctx.restore();
  }
}
