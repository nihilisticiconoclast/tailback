const fs = require('fs');

let content = fs.readFileSync('js/circuit.js', 'utf8');

// Replace P * 0.5 with P * 0.9 in circuit.js
content = content.replace(/gap < P \* 0\.5/g, 'gap < P * 0.9');
content = content.replace(/gap > P \* 0\.5/g, 'gap > P * 0.9');

fs.writeFileSync('js/circuit.js', content);
