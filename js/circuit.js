/**
 * The circuit: a live M/D/1 busy period, simulated rather than staged.
 *
 * One lane, no overtaking, a fixed disturbance point. When a braking event is
 * due, the next car to reach the disturbance stops and takes D seconds to get
 * through it. Any car that catches the back of the queue while that is going on
 * has to stop too, and inherits its own D-second window when its turn comes.
 * The cascade ends when the queue empties.
 *
 * That is the whole of the Borel mechanism, and everything on screen is read
 * off it rather than imposed on it:
 *
 *   - the tree is the record of which car stopped during which car's window,
 *     so a node appears at the instant a car actually joins the queue;
 *   - the cascade size is the number of cars served in the busy period, counted
 *     as it happens;
 *   - cars are never teleported. A car joins the queue when it reaches the back
 *     of it, and queued cars drive forward into the space ahead as the front is
 *     released, so the tailback stacks and shuffles the way a real one does.
 *
 * An earlier version drew a cascade from the sampler and then puppeted the cars
 * to match it, which is why they jumped and why the tree could keep filling
 * while nothing was arriving.
 */

const CAR_LENGTH = 11;
const CAR_WIDTH = 6;
const QUEUE_PITCH = 13.5;
const ROAD_WIDTH = 26;
const RELEASE_FADE = 1.6;
/** How much faster than cruising a delayed car may travel to close its gap. */
const CATCHUP = 2.2;
/**
 * Above criticality a cascade genuinely never ends, so the animation has to
 * give up somewhere. Reaching this is reported as "did not clear" rather than
 * as a size, which is the same thing the histogram's sampler does.
 */
const CASCADE_CAP = 300;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Tidy-tree layout: x by generation, y by leaf order, parents centred on children. */
function layoutTree(parent, generation) {
  const n = parent.length;
  const children = Array.from({ length: n }, () => []);
  for (let i = 1; i < n; i += 1) children[parent[i]].push(i);

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
  let depth = 0;
  for (let i = 0; i < n; i += 1) depth = Math.max(depth, generation[i]);
  return { children, y, leaves: Math.max(1, slot), depth };
}

export class Circuit {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cars = [];
    this.cascade = null;
    this.triggerClock = 0;
    this.lastCascade = null;
    this.simTime = 0;
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
    if (this.stopFrac === undefined) this.stopFrac = (a * 0.62) / this.perimeter;
    this.stopLine = this.stopFrac * this.perimeter;
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

  /** Forward arc distance from a to b, always in [0, perimeter). */
  fwd(a, b) {
    return (((b - a) % this.perimeter) + this.perimeter) % this.perimeter;
  }

  distanceToStop(s) {
    return this.fwd(s, this.stopLine);
  }

  /**
   * Scatter cars uniformly at random around the loop. Uniform points on a
   * circle are a Poisson process conditioned on the count, and the windows that
   * matter here are a few tens of metres against a loop of kilometres, so
   * arrivals at the disturbance are Poisson to well within anything visible.
   * That is the assumption Borel needs, and `nominal` below is what preserves
   * it.
   */
  populate(count, rand) {
    this.cars = [];
    for (let i = 0; i < count; i += 1) {
      const at = rand() * this.perimeter;
      this.cars.push({ s: at, nominal: at, state: 'cruise', released: 0, node: -1 });
    }
    this.cascade = null;
    this.triggerClock = 0;
  }

  setCount(count, rand) {
    // Changing the car count mid-cascade would leave stopped cars stranded in a
    // queue that no longer exists, so abandon it and start clean.
    if (this.cascade) this.abandon();
    while (this.cars.length > count) this.cars.pop();
    while (this.cars.length < count) {
      const at = rand() * this.perimeter;
      this.cars.push({ s: at, nominal: at, state: 'cruise', released: 0, node: -1 });
    }
  }

  abandon() {
    if (!this.cascade) return;
    for (const car of this.cascade.queue) {
      car.state = 'cruise';
      car.released = 0.8;
    }
    this.cascade = null;
  }

  /** The seed braker: node 0, and the start of the busy period. */
  startCascade(car, serviceSec) {
    car.state = 'queued';
    car.node = 0;
    this.cascade = {
      parent: [-1],
      generation: [0],
      queue: [car],
      caught: 1,
      served: 0,
      start: this.simTime,
      workEnd: this.simTime + serviceSec,
      layout: null,
      layoutFor: -1,
      peakQueue: 1,
      truncated: false,
    };
  }

  /**
   * A car is caught by the cascade. Its parent is the car that was at the
   * disturbance at the moment this one arrives there — that car's clearance
   * window is what caught it. Catching in ascending distance means nodes are
   * created in arrival order, so node index equals service order and the tree
   * is generated breadth-first.
   */
  catchCar(car, arrivalTime, serviceSec) {
    const c = this.cascade;
    car.atSlot = false;
    const parent = Math.max(0, Math.min(c.caught - 1, Math.floor((arrivalTime - c.start) / serviceSec)));
    car.state = 'queued';
    car.node = c.parent.length;
    c.parent.push(parent);
    c.generation.push(c.generation[parent] + 1);
    c.queue.push(car);
    c.caught += 1;
    c.workEnd += serviceSec;
    if (c.queue.length > c.peakQueue) c.peakQueue = c.queue.length;
    if (c.caught >= CASCADE_CAP) c.truncated = true;
  }

  step(dt, metrics, params, rand, onCascadeComplete) {
    if (!(dt > 0) || this.cars.length === 0) return;
    const P = this.perimeter;
    const pxPerMetre = P / metrics.circuitM;
    const speedPx = metrics.speedMps * pxPerMetre;
    const pitch = Math.max(QUEUE_PITCH, 7 * pxPerMetre);
    const serviceSec = Math.max(0.05, params.clearSec);
    const ds = speedPx * dt;
    this.simTime += dt;

    // A braking event becomes due. The car that brakes is picked at random and
    // the disturbance happens where it happens to be, which is both what the
    // scenario actually says and what makes successive cascades independent:
    // every car runs at the same speed, so the loop is one frozen arrangement
    // of gaps. Braking at a fixed point would resample the same few gaps every
    // lap — sizes 3 and 4 never came up at all, while 5 came up twice as often
    // as it should. A uniformly random point samples the arrangement properly.
    if (!this.cascade) {
      this.triggerClock += dt * (params.triggerPerMin / 60);
      if (this.triggerClock >= 1) {
        this.triggerClock = 0;
        const pick = this.cars[Math.floor(rand() * this.cars.length)];
        if (pick && pick.state !== 'queued') {
          this.stopLine = pick.nominal;
          this.stopFrac = this.stopLine / P;
          this.startCascade(pick, serviceSec);
        }
      }
    }

    // Every car's nominal position advances, queued or not. This is the
    // undisturbed stream: it is never perturbed by the queue, which is what
    // keeps arrivals at the disturbance Poisson and therefore keeps the count
    // Borel. Rendered positions lag behind it and catch up; see below.
    for (const car of this.cars) {
      car.nominal = (car.nominal + ds) % P;
      if (car.released > 0) car.released = Math.max(0, car.released - dt);
    }

    if (this.cascade) {
      const c = this.cascade;

      // Which cars the cascade catches.
      //
      // The rule is the M/D/1 one, and it is *not* "the car reaches the back of
      // the queue". A car is caught if it would reach the disturbance itself
      // while the server is still working, i.e.
      //
      //     now + distance/speed  <  workEnd
      //
      // where workEnd is when everything caught so far will have cleared. That
      // is the definition of a busy period, and it is what makes the count
      // Borel. Catching at the physical tail instead counts a car the moment
      // the queue reaches back to it, which is earlier by (queue length)/speed
      // and inflates mu badly — at the defaults it pushed an intended 0.70 up
      // past 1, so cascades stopped terminating.
      //
      // Ascending distance, so cars are caught in the order they would arrive.
      // arrival < workEnd is exactly d < (workEnd - now) * speed, so filter on
      // that first and only sort the few cars that could possibly qualify.
      if (!c.truncated) {
        const reach = (c.workEnd - this.simTime) * speedPx;
        const candidates = this.cars
          .filter((car) => car.state !== 'queued')
          .map((car) => ({ car, d: this.fwd(car.nominal, this.stopLine) }))
          .filter((entry) => entry.d < reach)
          .sort((x, y) => x.d - y.d);

        for (const { car, d } of candidates) {
          if (c.truncated) break;
          const arrival = this.simTime + d / speedPx;
          if (arrival < c.workEnd) this.catchCar(car, arrival, serviceSec);
          else break; // ascending distance, so nothing further back qualifies
        }
      }

      // Service is a clock, not a queue-driven loop: the k-th car caught clears
      // at start + (k+1)*D whatever else is happening, so no service time can
      // bank up across a gap the way it used to.
      const done = Math.min(c.caught, Math.max(0, Math.floor((this.simTime - c.start) / serviceSec)));
      while (c.served < done && c.queue.length > 0) {
        const front = c.queue.shift();
        front.state = 'cruise';
        front.released = RELEASE_FADE;
        front.node = -1;
        c.served += 1;
      }

      if (this.simTime >= c.workEnd || c.truncated) {
        for (const car of c.queue) {
          car.state = 'cruise';
          car.released = RELEASE_FADE;
          car.node = -1;
        }
        c.queue.length = 0;
        c.served = c.caught;
        this.lastCascade = {
          size: c.caught,
          cleared: !c.truncated,
          depth: c.layout ? c.layout.depth : 0,
          peakQueue: c.peakQueue,
        };
        this.cascade = null;
        if (onCascadeComplete) onCascadeComplete(this.lastCascade);
      }
    }

    // Rendering only, from here down.
    //
    // Queued cars drive forward into the space ahead rather than being placed in
    // it, so the tailback stacks and shuffles the way a real one does. Once
    // released a car is behind where the undisturbed stream would have put it,
    // and closes that gap at up to CATCHUP times cruising speed — which is both
    // what real traffic does leaving a jam and what keeps the drawn cars
    // consistent with the stream driving the statistics.
    if (this.cascade) {
      const c = this.cascade;
      for (let j = 0; j < c.queue.length; j += 1) {
        const car = c.queue[j];
        const target = ((this.stopLine - j * pitch) % P + P) % P;
        const gap = this.fwd(car.s, target);
        if (gap > 0 && gap < P * 0.5) car.s = (car.s + Math.min(gap, ds)) % P;
        // Caught, but possibly still some way back: a car committed to stopping
        // can be most of a cascade's length away when it is counted. Only mark
        // it stopped once it is actually in its slot, so the red in the picture
        // means what the legend says it means.
        car.atSlot = this.fwd(car.s, target) <= ds;
      }

      // Cars the cascade did not catch are left alone. They reach the
      // disturbance only after the queue has drained — that is what "not
      // caught" means — so holding them behind the stack would be wrong twice
      // over: it bunches them at queue spacing, and that artificial bunch then
      // feeds the next cascade. An early attempt did exactly that and a
      // subcritical mu ran away, one cascade opening with sixteen cars caught.
      // The queue here is a vertical queue: drawn along the road so the
      // tailback is legible, but with no length as far as the model is
      // concerned.
    }

    for (const car of this.cars) {
      if (car.state === 'queued') continue;
      const gap = this.fwd(car.s, car.nominal);
      // gap near a full lap means the rendered car is essentially on its mark
      car.s = gap > P * 0.5 ? car.nominal : (car.s + Math.min(gap, CATCHUP * ds)) % P;
    }
  }

  get status() {
    const c = this.cascade;
    if (c) {
      return {
        running: true,
        served: c.served,
        stopped: c.queue.length,
        nodes: c.caught,

      };
    }
    return { running: false, last: this.lastCascade };
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
      mono: css('--font-mono'),
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
    if (this.cascade) this.drawTree(ctx, theme);
    for (const car of this.cars) this.drawCar(ctx, car, theme);
  }

  drawStopLine(ctx, theme) {
    const p = this.pointAt(this.stopLine);
    const th = this.headingAt(this.stopLine);
    const live = this.cascade !== null;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(th);
    ctx.strokeStyle = live ? theme.brake : theme.chalkFaint;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -ROAD_WIDTH / 2);
    ctx.lineTo(0, ROAD_WIDTH / 2);
    ctx.stroke();
    ctx.restore();

    // The label stays upright. The disturbance lands wherever the braking car
    // happens to be, so rotating it with the road puts it on its side whenever
    // that is a bend.
    ctx.save();
    ctx.fillStyle = live ? theme.brake : theme.chalkFaint;
    ctx.font = `600 9px ${theme.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const out = 1 + (ROAD_WIDTH / 2 + 12) / Math.hypot(p.x - this.geom.cx, p.y - this.geom.cy);
    ctx.fillText(
      'DISTURBANCE',
      this.geom.cx + (p.x - this.geom.cx) * out,
      this.geom.cy + (p.y - this.geom.cy) * out,
    );
    ctx.restore();
  }

  drawCar(ctx, car, theme) {
    const p = this.pointAt(car.s);
    const th = this.headingAt(car.s);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(th);
    if (car.state === 'queued' && car.atSlot) {
      ctx.fillStyle = theme.brake;
    } else if (car.state === 'queued') {
      ctx.fillStyle = theme.amber;
    } else if (car.released > 0) {
      ctx.fillStyle = theme.amber;
      ctx.globalAlpha = 0.35 + 0.45 * (car.released / RELEASE_FADE);
    } else {
      ctx.fillStyle = theme.flow;
      ctx.globalAlpha = 0.85;
    }
    ctx.beginPath();
    ctx.rect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH);
    ctx.fill();
    ctx.restore();
  }

  /** The branching record, drawn in the infield as it is built. */
  drawTree(ctx, theme) {
    const c = this.cascade;
    if (c.layoutFor !== c.parent.length) {
      c.layout = layoutTree(c.parent, c.generation);
      c.layoutFor = c.parent.length;
    }
    const { layout } = c;
    const { a, r, cx, cy } = this.geom;
    const boxW = a + r * 0.7;
    const boxH = 2 * r * 0.58;
    const x0 = cx - boxW / 2;
    const y0 = cy - boxH / 2;

    const cols = Math.max(1, layout.depth);
    const rows = Math.max(1, layout.leaves - 1);
    const px = (i) => x0 + (c.generation[i] / cols) * boxW;
    const py = (i) => y0 + (layout.y[i] / rows) * boxH;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.amber;
    const dense = c.parent.length > 120;
    ctx.globalAlpha = dense ? 0.16 : 0.28;
    ctx.beginPath();
    for (let i = 1; i < c.parent.length; i += 1) {
      const parent = c.parent[i];
      const xa = px(parent);
      const ya = py(parent);
      const xb = px(i);
      const yb = py(i);
      const mid = (xa + xb) / 2;
      ctx.moveTo(xa, ya);
      ctx.bezierCurveTo(mid, ya, mid, yb, xb, yb);
    }
    ctx.stroke();

    const nodeR = c.parent.length > 240 ? 1.1 : c.parent.length > 80 ? 1.4 : 1.7;
    for (let i = 0; i < c.parent.length; i += 1) {
      const cleared = i < c.served;
      ctx.globalAlpha = cleared ? 0.95 : 0.4;
      ctx.fillStyle = cleared ? theme.brake : theme.amber;
      ctx.beginPath();
      ctx.arc(px(i), py(i), nodeR * (cleared ? 1.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.chalkFaint;
    ctx.font = `600 9px ${theme.mono}`;
    ctx.textAlign = 'left';
    ctx.fillText(
      `THIS CASCADE  ${c.served} CLEARED  ${c.queue.length} TO CLEAR  DEPTH ${layout.depth}`,
      x0,
      y0 - 12,
    );
    ctx.restore();
  }
}
