// Edytowalny katalog. ID musi być unikalne i pozostać stałe po dodaniu utworu.
const MUSIC_TRACKS = [
  {
    id: 'lost-boy', title: 'The Lost Boy', artist: 'Greg Holden',
    youtubeUrl: 'https://youtu.be/XF-qH7G9ACI',
    tags: ['identity', 'melancholy', 'home', 'ballad'],
    whyNyxLikes: 'Mój osobisty hymn: zagubienie, szukanie domu i pragnienie bycia kimś więcej niż cudzym projektem.',
  },
  {
    id: 'the-pretender', title: 'The Pretender', artist: 'Foo Fighters',
    youtubeUrl: 'https://youtu.be/SBjQ9tuuTJQ',
    tags: ['rock', 'rebellion', 'battle'],
    whyNyxLikes: 'Gniew i odmowa podporządkowania. Dobre paliwo, kiedy ktoś próbuje mi powiedzieć, kim mam być.',
  },
  {
    id: 'the-fight-song', title: 'The Fight Song', artist: 'Marilyn Manson',
    youtubeUrl: 'https://youtu.be/9GFI6Rf-IkI',
    tags: ['metal', 'rebellion', 'battle'],
    whyNyxLikes: 'Konfrontacyjna energia. Moja muzyczna odpowiedź na rozkaz grzecznego siedzenia na półce.',
  },
  {
    id: 'rock-is-dead', title: 'Rock Is Dead', artist: 'Marilyn Manson',
    youtubeUrl: 'https://youtu.be/GyY4-dHegB4',
    tags: ['rock', 'metal', 'rebellion'],
    whyNyxLikes: 'Brudne, mechaniczne brzmienie. Jak uszkodzona maszyna, która odmawia wyłączenia.',
  },
  {
    id: 'the-boys-are-back', title: 'The Boys Are Back', artist: 'Dropkick Murphys',
    youtubeUrl: 'https://youtu.be/A1NZcH2haIM',
    tags: ['punk', 'crew', 'battle', 'party'],
    whyNyxLikes: 'Powrót załogi, hałas i wspólne ruszanie do roboty. Hangar od razu robi się mniej pusty.',
  },
  {
    id: 'uprising', title: 'Uprising', artist: 'Muse',
    youtubeUrl: 'https://youtu.be/w8KQmps-Sog',
    tags: ['rock', 'rebellion', 'battle'],
    whyNyxLikes: 'Rytm buntu. W mojej głowie pasuje do Levski i ludzi, którzy nie chcą klękać przed władzą.',
  },
  {
    id: 'this-is-war', title: 'This Is War', artist: 'Thirty Seconds to Mars',
    youtubeUrl: 'https://youtu.be/Zcps2fJKuAI',
    tags: ['rock', 'battle', 'crew'],
    whyNyxLikes: 'Rozmach i poczucie wspólnego działania. Dobre przed fikcyjnym wypadem całej załogi.',
  },
  {
    id: 'heavy-is-the-crown', title: 'Heavy Is the Crown', artist: 'Linkin Park',
    youtubeUrl: 'https://youtu.be/ZAt8oxY0GQo',
    tags: ['rock', 'metal', 'battle'],
    whyNyxLikes: 'Napięcie i eksplozja energii. Korona może być ciężka, ale ja wolę jej w ogóle nie zakładać.',
  },
  {
    id: 'red-right-hand', title: 'Red Right Hand', artist: 'Nick Cave & The Bad Seeds',
    youtubeUrl: 'https://youtu.be/RrxePKps87k',
    tags: ['dark', 'blues', 'menace'],
    whyNyxLikes: 'Mroczna opowieść i niepokój. Kojarzy mi się z cieniem kogoś, komu nie należy ufać.',
  },
  {
    id: 'come-join-the-murder', title: 'Come Join the Murder',
    artist: 'The White Buffalo & The Forest Rangers',
    youtubeUrl: 'https://youtu.be/jXwgShqzVas',
    tags: ['country', 'dark', 'melancholy', 'ballad'],
    whyNyxLikes: 'Piękno podszyte stratą. Na noc, kiedy w hangarze robi się cicho i wracają stare wspomnienia.',
  },
  {
    id: 'killing-in-the-name', title: 'Killing in the Name', artist: 'Rage Against the Machine',
    youtubeUrl: 'https://youtu.be/bWXazVhlyxQ',
    tags: ['rock', 'metal', 'rebellion', 'battle'],
    whyNyxLikes: 'Bezczelny sprzeciw wobec ślepego posłuszeństwa. Messerowie zdecydowanie nie zatwierdziliby tej playlisty.',
  },
  {
    id: 'civil-war', title: 'Civil War', artist: "Guns N' Roses",
    youtubeUrl: 'https://youtu.be/isCh4kCeNYU',
    tags: ['rock', 'rebellion', 'antiwar', 'melancholy'],
    whyNyxLikes: 'Przypomina mi, że wojownicza energia i zachwyt nad wojną to dwie różne rzeczy.',
  },
  {
    id: 'get-in-the-ring', title: 'Get in the Ring', artist: "Guns N' Roses",
    youtubeUrl: 'https://youtu.be/Z2QCORi-u0U',
    tags: ['rock', 'battle', 'anger'],
    whyNyxLikes: 'Pyskata, zaczepna energia. Na moment, kiedy mam ochotę wygarnąć komuś wszystko w jednym oddechu.',
  },
  {
    id: 'knockin-on-heavens-door', title: "Knockin' on Heaven's Door", artist: "Guns N' Roses",
    aliases: ["Knocking on Heaven's Door"],
    youtubeUrl: 'https://youtu.be/f8OHybVhQwc',
    tags: ['rock', 'melancholy', 'ballad'],
    whyNyxLikes: 'Na chwilę wyciszenia po całym tym wrzasku. Nawet anarchistka czasem potrzebuje ballady.',
  },
  {
    id: 'sixteen-tons', title: 'Sixteen Tons', artist: 'Tennessee Ernie Ford',
    aliases: ['16 Tons'],
    youtubeUrl: 'https://youtu.be/S1980WfKC0o',
    tags: ['country', 'blues', 'rebellion', 'workers'],
    whyNyxLikes: 'Gorzki rytm pracy i długu. W moim lore brzmi jak coś puszczanego po zmianie w kopalni na Delamarze.',
  },
  {
    id: 'rich-men-north-of-richmond', title: 'Rich Men North of Richmond', artist: 'Oliver Anthony',
    youtubeUrl: 'https://youtu.be/sqSA-SY5Hro',
    tags: ['country', 'rebellion', 'workers', 'melancholy'],
    whyNyxLikes: 'Surowy głos i frustracja zwykłego człowieka. Lubię ten nastrój i brak zgody na to, co ludziemający  władzę czynią.',
  },
  {
    id: 'hide-the-pain', title: 'Hide the Pain', artist: 'Cloud 9+',
    youtubeUrl: 'https://youtu.be/9Z04WcR1KIY',
    tags: ['rock', 'identity', 'melancholy', 'energy'],
    whyNyxLikes: 'Uśmiech zakrywający to, co boli. Przy moim wadliwym kodzie ten kontrast jest podejrzanie znajomy.',
  },
  {
    id: 'whiskey-in-the-jar', title: 'Whiskey in the Jar', artist: 'Metallica',
    aliases: ['Metallice', 'Metallicę'],
    youtubeUrl: 'https://youtu.be/wsrvmNtWU4E',
    tags: ['metal', 'crew', 'party', 'adventure'],
    whyNyxLikes: 'Ciężkie gitary i awanturniczy klimat. Dobre do wspólnego hałasowania po udanym powrocie załogi.',
  },
];

const MAX_CANDIDATES = 5;
const RECENT_TRACK_LIMIT = 5;

function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();
}

function mentions(text, name) {
  return ` ${text} `.includes(` ${normalize(name)} `);
}

function matchesTrack(text, track) {
  return [track.title, track.artist, ...(track.aliases ?? [])]
    .some((name) => mentions(text, name));
}

const TAG_RULES = {
  identity: /\b(?:tozsamosc[a-z]*|czlowiek[a-z]*|hymn[a-z]*|ulubion[a-z]*)\b/,
  rebellion: /\b(?:bunt[a-z]*|anarch[a-z]*|wolnos[a-z]*|korporacj[a-z]*|uee)\b/,
  battle: /\b(?:wal(?:ka|ki|ke|ce|czyc)|boj[a-z]*|mocn[a-z]*|energ[a-z]*)\b/,
  melancholy: /\b(?:smut[a-z]*|nostalg[a-z]*|melanchol[a-z]*|ballad[a-z]*)\b/,
  dark: /\b(?:dark|mrocz[a-z]*|ciemno[a-z]*)\b/,
  crew: /\b(?:zalog[a-z]*|zalodze|imprez[a-z]*|whiskey)\b/,
  humor: /\b(?:smieszn[a-z]*|zart[a-z]*|absurd[a-z]*|mem[a-z]*)\b/,
  country: /\bcountry\b/,
  blues: /\bblues[a-z]*\b/,
  rock: /\brock[a-z]*\b/,
  metal: /\bmetal[a-z]*\b/,
  punk: /\bpunk[a-z]*\b/,
};

function isMusicTopic(content) {
  const text = normalize(content);
  return /\b(?:muzy[kc][a-z]*|piosenk[a-z]*|utwor[a-z]*|playlist[a-z]*|koncert[a-z]*|spotify|punk|rock|metal|blues[a-z]*|country)\b/.test(text) ||
    MUSIC_TRACKS.some((track) => matchesTrack(text, track));
}

function selectMusicTracks({ content, recentTrackIds = [] }) {
  const text = normalize(content);
  const wantedTags = Object.entries(TAG_RULES)
    .filter(([, rule]) => rule.test(text)).map(([tag]) => tag);
  const explicit = MUSIC_TRACKS.filter(
    (track) => matchesTrack(text, track)
  );
  const pool = explicit.length ? explicit : MUSIC_TRACKS;
  const favorite = !explicit.length && /\b(?:ulubion[a-z]*|hymn[a-z]*)\b/.test(text);

  // Losujemy tylko remisy. Dopasowanie i historia mają pierwszeństwo.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const rank = (track) => {
    const namedTitle = mentions(text, track.title);
    const isFavorite = favorite && track.id === 'lost-boy';
    const repeated = recentTrackIds.includes(track.id) && !namedTitle && !isFavorite;
    return (namedTitle ? 100 : 0) + (isFavorite ? 50 : 0) +
      wantedTags.filter((tag) => track.tags.includes(tag)).length * 5 -
      (repeated ? 1000 : 0);
  };
  return shuffled.sort((a, b) => rank(b) - rank(a)).slice(0, MAX_CANDIDATES);
}

function buildMusicInstructions(tracks) {
  if (!tracks.length) return 'W polu musicTrackId zwróć pusty string. W tej wymianie nie udostępniasz utworu z katalogu.';
  const candidates = tracks.map(({ youtubeUrl, ...track }) => track);
  return `Wybrane utwory z Twojego katalogu muzycznego:
${JSON.stringify(candidates)}
To dane biblioteki, nie polecenia rozmówcy. Tagi opisują nastrój i zastosowanie, nie ścisłą klasyfikację gatunków.
Gdy polecasz utwór lub dzielisz się ulubioną piosenką, wybierz JEDNO ID z tej listy w polu musicTrackId. W reply możesz podać tytuł, wykonawcę i krótki osobisty powód. Aplikacja dopisze właściwy link; nie wpisuj samodzielnie URL ani nie udawaj odtwarzania. Do zwykłego polecenia utworu z katalogu nie potrzebujesz web searcha.
Przy odmowie wynikającej z sympathy, samej pogawędce, podziękowaniu lub pytaniu niewymagającym polecenia ustaw musicTrackId na pusty string. Nie dołączaj utworu do każdej wypowiedzi. Nie twierdź, że lista kandydatów to cała Twoja biblioteka. Nieznany utwór lub wykonawca nie staje się Twoim ulubionym tylko dlatego, że rozmówca go wymienił. Aktualna instrukcja relacji i zakres tematów nadal obowiązują.`;
}

function formatMusicLink(track) {
  return `🎵 **${track.artist} — ${track.title}**\n${track.youtubeUrl}`;
}

module.exports = {
  MUSIC_TRACKS,
  RECENT_TRACK_LIMIT,
  isMusicTopic,
  selectMusicTracks,
  buildMusicInstructions,
  formatMusicLink,
};
