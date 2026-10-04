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

// Wyraźne odniesienia do broni osobistej odróżniamy od uzbrojenia statków.
const PERSONAL_WEAPON_RULE = /\b(?:fps|spluw[a-z]*|karabin[a-z]*|strzelb[a-z]*|shotgun[a-z]*|pistolet[a-z]*|rewolwer[a-z]*|r97|br[-\s]?2|ravager(?:[-\s]?212)?|coda|pulverizer[a-z]*|killshot[a-z]*|ripper[a-z]*|arlington[a-z]*|clem[a-z]*|polli dalal)\b/;

const TOPIC_RULES = {
  organizations: [
    /\b(?:lynx(?:co|corp)?|blastoff|blast off(?: solutions)?|aipoch|airborne pork chops|skrzydlat[a-z]* schabow[a-z]*|pgg|polska gromada gwiezdna|pvof|polish voices of freedom|twh|the winged hussars|skrzydlat[a-z]* husari[a-z]*)\b/,
    /\b(?:polsk[a-z]*|znajom[a-z]*|zaprzyjaznion[a-z]*|inn[a-z]*)\s+(?:organizacj[a-z]*|org(?:i|ow|ami)?)\b/,
    /\b(?:sojusz[a-z]*|relacj[a-z]*)\b[\s\S]{0,60}\b(?:organizacj[a-z]*|org(?:i|ow|ami)?|umc)\b/,
  ],
  project: [
    /\b(?:cig|cloud imperium|chris(?:a|ie)? roberts[a-z]*|jared[a-z]*|huckab[a-z]*|disco lando|crowdfunding[a-z]*|development[a-z]*)\b/,
    /\b(?:finansowan[a-z]*|roadmap[a-z]*|pledge|game package|free fly)\b/,
    /\b(?:projekt[a-z]*|rozwoj[a-z]*|obietnic[a-z]*|marketing[a-z]*)\b[\s\S]{0,80}\b(?:sc|star citizen|rsi)\b/,
    /\b(?:sc|star citizen)\b[\s\S]{0,80}\b(?:projekt[a-z]*|rozwoj[a-z]*|obietnic[a-z]*|marketing[a-z]*|wart[a-z]*|ukoncz[a-z]*)\b/,
    /\b(?:kupic|kupowac|dolaczyc|zaczac|polecasz|warto|myslisz|sadzisz|oceniasz|lubisz)\b[\s\S]{0,80}\b(?:sc|star citizen)\b/,
  ],
  umc: [
    /\b(?:umc|unholy maiden|lastdunadan[a-z]*|dunadan[a-z]*|axinpel[a-z]*|axident[a-z]*|karen galaxy|alice void|blondyn[a-z]*)\b/,
    /\bnasz[a-z]*\s+(?:organizacj[a-z]*|zalog[a-z]*|zalodze|flot[a-z]*)\b/,
  ],

  ships: [
    /\b(?:stat(?:ek|k)[a-z]*|okret[a-z]*|mysliw[a-z]*|fracht[a-z]*|hangar[a-z]*|scu)\b/,
    /\b(?:argo|aegis|anvil|aopoa|banu|crusader|drake|esperia|gatac|greycat|kruger|mirai|misc|origin|rsi|tumbril)\b/,
    /\b(?:consolidated outland|grey's market)\b/,
    /\b(?:auror[a-z]*|avenger[a-z]*|titan[a-z]*|cutter[a-z]*|cutlass[a-z]*|nomad[a-z]*|pisces|mustang[a-z]*|arrow[a-z]*|hornet[a-z]*|carrack[a-z]*|reclaimer[a-z]*|hammerhead[a-z]*|idris[a-z]*|polaris[a-z]*|perseus[a-z]*|perseusz[a-z]*|ironclad[a-z]*|kraken[a-z]*|mpuv[a-z]*|guardian[a-z]*|freelancer[a-z]*|reliant[a-z]*|odyssey|merchantman[a-z]*|railen[a-z]*|prowler[a-z]*|wolf[a-z]*)\b/,
    /\b(?:starfarer[a-z]*|naped[a-z]*|ladown[a-z]*|wiezycz[a-z]*|wieza|wieze)\b/,
  ],

  weapons: [
    PERSONAL_WEAPON_RULE,
    /\b(?:bron(?:i|ia)?|behring[a-z]*|gemini|kastak[a-z]*|hedeb[a-z]*|bunk(?:ier|r)[a-z]*)\b/,
    /\b(?:kastak arms|klaus\s*(?:&|i|and)\s*werner|grey['’]s market)\b/,
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
  purchasePending = false,
}) {
  const text = normalize(content);

  let detectedTopics = Object.entries(TOPIC_RULES)
    .filter(([, rules]) => rules.some((rule) => rule.test(text)))
    .map(([topic]) => topic);

  // „Broń do Arrowa” i „Starfarer Gemini” nie wymagają gustu broni ręcznej.
  // Konkretne modele FPS w rozmowie o statkach mogą dołączyć oba moduły.
  if (detectedTopics.includes('ships') && !PERSONAL_WEAPON_RULE.test(text)) {
    detectedTopics = detectedTopics.filter((topic) => topic !== 'weapons');
  }

  if (/\b(?:build|loadout)[a-z]*\b/.test(text) &&
      !detectedTopics.some((topic) => topic === 'ships' || topic === 'weapons')) {
    const topic = previousTopics.includes('weapons') && !previousTopics.includes('ships')
      ? 'weapons' : 'ships';
    detectedTopics.push(topic);
  }

  if (isMusicTopic(text)) detectedTopics.push('music');

  const musicFollowUp = previousTopics.includes('music') &&
    /^(?:(?:a\s+)?(?:daj|polec|pokaz|podrzuc)\s+(?:mi\s+)?cos\b|(?:a\s+)?cos\s+(?:innego|mocniejszego|spokojniejszego)\b)/.test(text);
  const projectFollowUp = previousTopics.includes('project') &&
    /^(?:(?:tak|nie)\b|[123][\s).:]|jestem (?:fanem|programista|developerem)|akceptuje\b|lubie science fiction\b|a (?:co|jak)\b)/.test(text);
  const purchaseFollowUp = purchasePending && previousTopics.includes('project') &&
    !/^(?:czesc|hej|witaj|dzien dobry|dobranoc)\b/.test(text);
  const isFollowUp = purchaseFollowUp || projectFollowUp || musicFollowUp || FOLLOW_UP_RULES.some((rule) => rule.test(text));

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
