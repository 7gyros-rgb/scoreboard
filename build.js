const fs = require('fs');
const path = require('path');
const versionFile = path.join(__dirname, 'version.txt');
const now = new Date().toISOString();
fs.writeFileSync(versionFile, now + '\n', 'utf8');
console.log('Wrote version:', now);
