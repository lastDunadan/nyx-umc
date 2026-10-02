function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

const TOPIC_RULES = {
  umc: [
    /\b(?:umc|unholy maiden|lastdunadan|dunadan|axinpel|axident|karen galaxy|blondyna)\b/,
    /\b(?:nasza|naszej|naszego)\s+(?:organizacja|organizacji|zaloga|zalogi|flota|floty)\b/,
  ],

  ships: [
    /\b(?:stat(?:ek|k)[a-z]*|okret[a-z]*|mysliw[a-z]*|fracht[a-z]*|hangar[a-z]*|scu)\b/,
    /\b(?:argo|aegis|anvil|aopoa|banu|crusader|drake|esperia|gatac|greycat|kruger|mirai|misc|origin|rsi|tumbril)\b/,
    /\b(?:consolidated outland|grey's market)\b/,
    /\b(?:aurora|avenger|titan|cutter|cutlass|nomad|pisces|mustang|arrow|hornet|carrack|reclaimer|hammerhead|idris|polaris|perseus|perseusz[a-z]*|ironclad|kraken|mpuv|guardian|freelancer|reliant|odyssey|merchantman|rail(en)?|prowler|wolf)\b/,
    /\b(?:build|loadout|naped[a-z]*|ladown[a-z]*|wiezycz[a-z]*|wieza|wieze)\b/,
  ],

  humor: [
    /\b(?:zart[a-z]*|dowcip[a-z]*|dwuznaczn[a-z]*|twss)\b/,
    /that's what she said/,
    /\b(?:przeklenstw[a-z]*|przeklin[a-z]*|strof[a-z]*)\b/,
  ],
};

// Kontynuacje, które bez poprzedniej wymiany nie wskazują tematu.
const FOLLOW_UP_RULES = [
  /^(?:a\s+)?(?:co|cos)\s+jeszcze\b/,
  /^tylko\s+tyle\b/,
  /^(?:a\s+)?(?:jakie|jakies)\s+alternatywy\b/,
  /^(?:a\s+)?(?:jego|jej|ich)\s+/,
  /^a\s+co\s+z\s+(?:nim|nia|nimi|jego|jej|ich|tym|ta)\b/,
  /^a\s+(?:jak|jesli)\s+nie\s+(?:ten|ta|to)\b/,
  /^(?:rozwin|doprecyzuj|wyjasnij|porownaj|opowiedz wiecej)\b/,
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

  const isFollowUp = FOLLOW_UP_RULES.some((rule) => rule.test(text));

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