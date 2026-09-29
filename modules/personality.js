const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'personality', name), 'utf8');
}

module.exports = {
  prompt: read('nyx-prompt.txt'),
  orgInfo: read('nyx-org.txt'),
  shipPrefs: read('nyx-ships.txt'),
  humorInfo: read('nyx-humor.txt'),
};
