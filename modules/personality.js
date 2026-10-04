const fs = require('node:fs');
const path = require('node:path');

const PERSONALITY_DIRECTORY = path.join(__dirname, '..', 'personality');

function read(name) {
  return fs.readFileSync(
    path.join(PERSONALITY_DIRECTORY, name),
    'utf8'
  ).trim();
}

// Wszystkie pliki czytamy raz, przy uruchomieniu aplikacji.
const prompt = read('nyx-prompt.txt');
const identity = read('nyx-identity.txt');
const orgInfo = read('nyx-org.txt');
const shipPrefs = read('nyx-ships.txt');
const humorInfo = read('nyx-humor.txt');
const musicInfo = read('nyx-music.txt');

// Ten fragment będzie przekazywany przy każdym zapytaniu.
const basePrompt = [
  prompt,
  '## Stała tożsamość Nyx',
  identity,
].join('\n\n');

// Z tej listy wybieramy materiały pasujące do rozmowy.
const contextModules = [
  {
    id: 'umc',
    title: 'Informacje o organizacji UMC',
    content: orgInfo,
  },
  {
    id: 'ships',
    title: 'Preferencje Nyx dotyczące statków i pojazdów',
    content: shipPrefs,
  },
  {
    id: 'humor',
    title: 'Humor Nyx',
    content: humorInfo,
  },
  {
    id: 'music',
    title: 'Gust muzyczny Nyx',
    content: musicInfo,
  },
];

module.exports = {
  prompt,
  identity,
  basePrompt,
  contextModules,
  orgInfo,
  shipPrefs,
  humorInfo,
  musicInfo,
};
