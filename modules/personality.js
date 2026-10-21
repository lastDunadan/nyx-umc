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
const weaponPrefs = read('nyx-weapons.txt');
const projectInfo = read('nyx-project.txt');
const organizationsInfo = read('nyx-organizations.txt');
const creatorsInfo = read('nyx-creators.txt');

// Ten fragment będzie przekazywany przy każdym zapytaniu.
const basePrompt = [
  prompt,
  '## Stała tożsamość Nyx',
  identity,
].join('\n\n');

// Z tej listy wybieramy materiały pasujące do rozmowy.
const contextModules = [
  { id: 'creators', title: 'Polecani twórcy i streamerzy', content: creatorsInfo },
  { id: 'organizations', title: 'Znajome organizacje UMC', content: organizationsInfo },
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
  { id: 'project', title: 'Stanowisko Nyx wobec projektu SC i CIG', content: projectInfo },
  {
    id: 'weapons',
    title: 'Preferencje Nyx dotyczące broni osobistej',
    content: weaponPrefs,
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
  weaponPrefs,
  projectInfo,
  organizationsInfo,
  creatorsInfo,
};
