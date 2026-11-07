import re

with open('js/circuit.js', 'r') as f:
    content = f.read()

# Replace the catchup logic in step()
# 1. Update the loop over cascade queue to use this.distanceToStop()
search_queue_loop = """
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
"""

replace_queue_loop = """
    if (this.cascade) {
      const c = this.cascade;
      for (let j = 0; j < c.queue.length; j += 1) {
        const car = c.queue[j];
        const distToStop = this.distanceToStop(car.s);
        const targetDistToStop = j * pitch;

        if (distToStop > targetDistToStop) {
            const gap = distToStop - targetDistToStop;
            car.s = (car.s + Math.min(gap, ds)) % P;
        } else if (distToStop < targetDistToStop - ds) {
            const target = ((this.stopLine - targetDistToStop) % P + P) % P;
            const gap = this.fwd(car.s, target);
            if (gap > 0 && gap < P * 0.5) car.s = (car.s + Math.min(gap, ds)) % P;
        }

        car.atSlot = Math.abs(this.distanceToStop(car.s) - targetDistToStop) <= ds;
      }
"""

content = content.replace(search_queue_loop.strip(), replace_queue_loop.strip())

# 2. Update the unqueued car loop
search_cruise_loop = """
    for (const car of this.cars) {
      if (car.state === 'queued') continue;
      const gap = this.fwd(car.s, car.nominal);
      // gap near a full lap means the rendered car is essentially on its mark
      car.s = gap > P * 0.5 ? car.nominal : (car.s + Math.min(gap, CATCHUP * ds)) % P;
    }
"""

replace_cruise_loop = """
    for (const car of this.cars) {
      if (car.state === 'queued') continue;
      const gap = this.fwd(car.s, car.nominal);
      // gap near a full lap means the rendered car is essentially on its mark
      car.s = gap > P * 0.9 ? car.nominal : (car.s + Math.min(gap, CATCHUP * ds)) % P;
    }
"""

content = content.replace(search_cruise_loop.strip(), replace_cruise_loop.strip())

with open('js/circuit.js', 'w') as f:
    f.write(content)
