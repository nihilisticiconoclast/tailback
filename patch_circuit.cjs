const fs = require('fs');

let content = fs.readFileSync('js/circuit.js', 'utf8');

// Replace queue loop logic
content = content.replace(
  /const gap = this\.fwd\(car\.s, target\);\n\s*if \(gap > 0 && gap < P \* 0\.5\)/,
  'const gap = this.fwd(car.s, target);\n        if (gap > 0 && gap < P - 20)'
);
content = content.replace(
  /car\.atSlot = this\.fwd\(car\.s, target\) <= ds;/,
  'car.atSlot = gap <= ds || gap >= P - ds;'
);

// Replace unqueued logic
content = content.replace(
  /const gap = this\.fwd\(car\.s, car\.nominal\);\n\s*\/\/ gap near a full lap means the rendered car is essentially on its mark\n\s*car\.s = gap > P \* 0\.5 \? car\.nominal : \(car\.s \+ Math\.min\(gap, CATCHUP \* ds\)\) % P;/,
  'const gap = this.fwd(car.s, car.nominal);\n      car.s = gap > P - 20 ? car.nominal : (car.s + Math.min(gap, CATCHUP * ds)) % P;'
);

fs.writeFileSync('js/circuit.js', content);
