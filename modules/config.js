// Można zastąpić nazwy kanałów ich ID; wątki nie są automatycznie dozwolone.
const CHAT_MEMORY = {
  CHANNELS: ['💬-lobby', '🌍-lobby-int', '🍻-kantyna', '🧨-offtop'],
  MAX_MESSAGES: 20,
  MAX_MESSAGE_CHARS: 3000,
  MAX_CONTEXT_CHARS: 12000,
};

const TIMER_VALUE = {
  TEST: 20 * 1000,
  LIVE: 5 * 60 * 1000,
};
const SPONTANEOUS_COOLDOWN_MS = TIMER_VALUE.TEST;

const SPONTANEOUS_STICKERS = {
  WAR_CHANCE: 0.15,
  WAR_CONTEXT_MS: 10 * 60 * 1000,
  BORED_CHANNELS: ['💬-lobby', '🍻-kantyna'],
  BORED_IDLE_MS: 6 * 60 * 60 * 1000,
  BORED_RECENT_ACTIVITY_MS: 24 * 60 * 60 * 1000,
  BORED_CHECK_MS: 15 * 60 * 1000,
  BORED_CHANCE: 0.10,
};

const FEATURES = {
  SWEAR_CHECK: true,                          // spontaniczne strofowanie za przekleństwa
  TWSS_JOKE: true,                            // spontaniczny żart „That's what she said!”
  NAME_TRIGGER: true,                         // reakcja na „Nyx” napisane bez @
  NEWS_REPORT: true,                          // raportowanie zmian z kanałów '💾-aktualizacje' oraz '💧-przecieki'
  WAR_STICKER: true,
  BORED_STICKER: true,
};

const NEWS_REPORT = {
  TIME_ZONE: 'Europe/Warsaw',
  HOUR: 9,
  MINUTE: 0,
  LOOKBACK_HOURS: 24,
  GUILD_ID: '',                               // Przy jednym serwerze można zostawić pusty; inaczej wpisz ID UMC.
  SOURCE_CHANNELS: {
    updates: '💾-aktualizacje',
    leaks: '💧-przecieki',
  },
  TARGET_CHANNEL: '💬-lobby',                // Po testach: '💬-lobby'.
  TEST_ON_START: false,                       // true = raport od razu po każdym uruchomieniu bota.
  MAX_MESSAGES_PER_CHANNEL: 500,              // Po przekroczeniu limitu raport nie zostanie wysłany.
  MAX_INPUT_CHARS: 45000,
};

const HUMOR_CANDIDATE_PL =
  /wejd|wchodz|wsuń|wsun|wciś|wcis|włóż|wloz|mieści|miesci|duż|duz|dług|dlug|ciasn|głębok|glebok|od tyłu|od tylu|otwór|otwor|ląduj|laduj/i;

const HUMOR_CANDIDATE_EN =
  /\b(?:fit|fits|fitting|tight|deep|deeper|hard|harder|long|longer|inside|insert|inserting|slide|sliding|squeeze|squeezing|huge)\b|\btoo big\b|\bfrom behind\b|\b(?:push|put|stick) it in\b|\b(?:won't|doesn't) go in\b/i;
const SWEAR_CANDIDATE_PL = /cholera|kurw|pierdol|jeb|chuj|(?<!\p{L})dup(?:a|y|ie|ą|ę)(?!\p{L})/iu;
const SWEAR_CANDIDATE_EN = /fuck|shit|damn|\bass(?:hole|es)?\b/i;

const POSITIVE_USER_REACTIONS = new Set([
  '❤️', '👍', '😀', '😄', '😆', '🤣', '🥰', '😏', '💋', '🥳', '💕', '👏',
]);

const NEGATIVE_USER_REACTIONS = new Set([
  '👎', '😒', '😠', '😡', '🤬', '🥱', '💩', '🖕',
]);

module.exports = {
  SPONTANEOUS_STICKERS,
  CHAT_MEMORY,
  FEATURES,
  NEWS_REPORT,
  SPONTANEOUS_COOLDOWN_MS,
  HUMOR_CANDIDATE_PL,
  HUMOR_CANDIDATE_EN,
  SWEAR_CANDIDATE_PL,
  SWEAR_CANDIDATE_EN,
  POSITIVE_USER_REACTIONS,
  NEGATIVE_USER_REACTIONS
};
