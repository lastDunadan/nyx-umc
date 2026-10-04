const { isMusicTopic } = require('./music');

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/^nyx(?:\s+ai)?(?:[\s,.:!?-]+|$)/u, '')
    .trim();
}

const TOPIC_RULES = {
  umc: [
    /\b(?:umc|unholy maiden|lastdunadan[a-z]*|dunadan[a-z]*|axinpel[a-z]*|axident[a-z]*|karen galaxy|alice void|blondyn[a-z]*)\b/,
    /\bnasz[a-z]*\s+(?:organizacj[a-z]*|zalog[a-z]*|zalodze|flot[a-z]*)\b/,
  ],

  ships: [
    /\b(?:stat(?:ek|k)[a-z]*|okret[a-z]*|mysliw[a-z]*|fracht[a-z]*|hangar[a-z]*|scu)\b/,
    /\b(?:argo|aegis|anvil|aopoa|banu|crusader|drake|esperia|gatac|greycat|kruger|mirai|misc|origin|rsi|tumbril)\b/,
    /\b(?:consolidated outland|grey's market)\b/,
    /\b(?:auror[a-z]*|avenger[a-z]*|titan[a-z]*|cutter[a-z]*|cutlass[a-z]*|nomad[a-z]*|pisces|mustang[a-z]*|arrow[a-z]*|hornet[a-z]*|carrack[a-z]*|reclaimer[a-z]*|hammerhead[a-z]*|idris[a-z]*|polaris[a-z]*|perseus[a-z]*|perseusz[a-z]*|ironclad[a-z]*|kraken[a-z]*|mpuv[a-z]*|guardian[a-z]*|freelancer[a-z]*|reliant[a-z]*|odyssey|merchantman[a-z]*|railen[a-z]*|prowler[a-z]*|wolf[a-z]*)\b/,
    /\b(?:build|loadout|naped[a-z]*|ladown[a-z]*|wiezycz[a-z]*|wieza|wieze)\b/,
  ],

  humor: [
    /\b(?:zart[a-z]*|dowcip[a-z]*|dwuznaczn[a-z]*|twss)\b/,
    /that['’]s what she said/,
    /\b(?:przeklenstw[a-z]*|przeklin[a-z]*|strof[a-z]*)\b/,
  ],
};

// Kontynuacje, które bez poprzedniej wymiany nie wskazują tematu.
const FOLLOW_UP_RULES = [
  /^(?:a\s+)?(?:co|cos)\s+jeszcze[.!?\s]*$/,
  /^tylko\s+tyle[.!?\s]*$/,
  /^(?:a\s+)?(?:jakie|jakies)\s+alternatywy[.!?\s]*$/,
  /^(?:a\s+)?(?:jego|jej|ich)\s+/,
  /^a\s+co\s+z\s+(?:nim|nia|nimi|jego|jej|ich|tym|ta)\b/,
  /^a\s+(?:jak|jesli)\s+nie\s+(?:ten|ta|to)\b/,
  /^(?:rozwin|doprecyzuj|wyjasnij|porownaj)(?:\s+(?:mi\s+)?to)?[.!?\s]*$/,
  /^opowiedz\s+(?:mi\s+)?wiecej[.!?\s]*$/,
  /^(?:tak|nie|jasne|dobrze|ok|okej|rozumiem)[.!?\s]*$/,
];

function selectPersonalityContext({
  content,
  contextModules,
  previousTopics = [],
}) {
  const text = normalize(content);

  const detectedTopics = Object.entries(TOPIC_RULES)
    .filter(([, rules]) => rules.some((rule) => rule.test(text)))
    .map(([topic]) => topic);

  if (isMusicTopic(text)) detectedTopics.push('music');

  const musicFollowUp = previousTopics.includes('music') &&
    /^(?:(?:a\s+)?(?:daj|polec|pokaz|podrzuc)\s+(?:mi\s+)?cos\b|(?:a\s+)?cos\s+(?:innego|mocniejszego|spokojniejszego)\b)/.test(text);
  const isFollowUp = musicFollowUp || FOLLOW_UP_RULES.some((rule) => rule.test(text));

  const requestedTopics = detectedTopics.length > 0
    ? detectedTopics
    : isFollowUp
      ? previousTopics
      : [];

  const requested = new Set(requestedTopics);

  // Korzystamy tylko z modułów rzeczywiście dostępnych w personality.js.
  const selectedModules = contextModules.filter(
    ({ id }) => requested.has(id)
  );

  const topics = selectedModules.map(({ id }) => id).sort();

  const instructions = selectedModules
    .map(({ title, content: moduleContent }) => (
      `## ${title}\n${moduleContent}`
    ))
    .join('\n\n');

  return {
    topics,
    contextKey: topics.join('|') || 'core',
    instructions,
  };
}

module.exports = { selectPersonalityContext };
