const TOPICS = ['general', 'concept', 'flight_ready', 'live', 'auec'];
const sourceSchema = { type: 'object', additionalProperties: false,
  properties: {
    url: { type: 'string' }, publishedOn: { type: ['string', 'null'] },
    version: { type: ['string', 'null'] }, origin: { type: 'string', enum: ['official', 'community', 'leak'] },
    supports: { type: 'string', enum: TOPICS }, evidence: { type: 'string' },
  }, required: ['url', 'publishedOn', 'version', 'origin', 'supports', 'evidence'] };
const evidenceFormat = { type: 'json_schema', name: 'nyx_research_evidence', strict: true,
  schema: { type: 'object', additionalProperties: false,
    properties: {
      timeSensitive: { type: 'boolean' }, liveVersion: { type: ['string', 'null'] },
      liveVersionSource: { anyOf: [sourceSchema, { type: 'null' }] },
      claims: { type: 'array', items: { type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string' }, topic: { type: 'string', enum: TOPICS },
          kind: { type: 'string', enum: ['fact', 'announcement', 'speculation'] },
          disputed: { type: 'boolean' },
          effectiveOn: { type: ['string', 'null'] },
          sources: { type: 'array', items: sourceSchema },
        }, required: ['text', 'topic', 'kind', 'disputed', 'effectiveOn', 'sources'] } },
      gaps: { type: 'array', items: { type: 'string' } },
    }, required: ['timeSensitive', 'liveVersion', 'liveVersionSource', 'claims', 'gaps'] } };

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return null; }
}
function officialUrl(value) {
  const host = new URL(value).hostname;
  return ['robertsspaceindustries.com', 'cloudimperiumgames.com']
    .some(domain => host === domain || host.endsWith(`.${domain}`));
}
function retrievalMetadata(result) {
  const retrieved = new Set(), opened = new Set();
  const add = (value, target = retrieved) => { const url = normalizeUrl(value); if (url) target.add(url); };
  for (const item of result.output ?? []) {
    if (item.type === 'web_search_call') {
      for (const source of item.action?.sources ?? []) add(source.url);
      if (item.action?.type === 'open_page' && item.status === 'completed') {
        add(item.action.url); add(item.action.url, opened);
      }
    }
    if (item.type === 'message') {
      for (const content of item.content ?? []) {
        for (const citation of content.annotations ?? []) if (citation.type === 'url_citation') add(citation.url);
      }
    }
  }
  return { retrieved, opened };
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function isTimeSensitive(query) {
  return /aktual|obecn|teraz|dzis|dziś|dostęp|dostep|cen[ayę]|balans|parametr|patch|live|ptu|auec|flight\s*ready|in[ -]game|przejści|przejsci|termin|current|latest|today|price|available|availability|release|status/i.test(query);
}

function validateEvidence(result, { query, asOf, phase = 'current' }) {
  const data = JSON.parse(result.output_text);
  if (!data || typeof data.timeSensitive !== 'boolean' || !Array.isArray(data.claims) ||
      !Array.isArray(data.gaps) || data.claims.length > 6 || data.gaps.length > 6) throw new Error('Niepoprawny raport źródeł.');
  const { retrieved, opened } = retrievalMetadata(result);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const timeSensitive = isTimeSensitive(query) || data.timeSensitive;
  const warnings = new Set();
  function source(value) {
    const url = normalizeUrl(value?.url);
    if (!url || !retrieved.has(url) || !TOPICS.includes(value.supports) ||
        typeof value.evidence !== 'string' || !value.evidence.trim() || value.evidence.length > 240) return null;
    const publishedOn = validDate(value.publishedOn);
    if ((value.publishedOn !== null && !publishedOn) || publishedOn > asOf) return null;
    const isOfficial = officialUrl(url);
    if (value.origin === 'official' && (!isOfficial || !opened.has(url))) {
      warnings.add('Nie potwierdzono odczytu oficjalnego oryginału; nie przedstawiaj go jako potwierdzenia RSI/CIG.');
      return null;
    }
    if (!['official', 'community', 'leak'].includes(value.origin) ||
        (isOfficial && value.origin !== 'official')) return null;
    return { url, publishedOn, version: typeof value.version === 'string' ? value.version.slice(0, 60) : null,
      origin: value.origin, supports: value.supports, evidence: value.evidence };
  }
  const versionSource = data.liveVersionSource ? source(data.liveVersionSource) : null;
  const liveVersion = typeof data.liveVersion === 'string' && data.liveVersion.length <= 60 &&
    !/\b(?:e?ptu|tech[ -]?preview)\b/i.test(data.liveVersion) &&
    versionSource?.supports === 'live' && versionSource.origin !== 'leak' &&
    versionSource.publishedOn >= yearStart && versionSource.version === data.liveVersion
    ? data.liveVersion : null;
  function fresh(item, kind = 'fact') {
    if (kind === 'fact' && liveVersion && item.version && item.version !== liveVersion) return false;
    return item.publishedOn >= yearStart || Boolean(liveVersion && item.version === liveVersion);
  }
  const claims = [];
  for (const claim of data.claims) {
    if (typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 600 ||
        !TOPICS.includes(claim.topic) || !['fact', 'announcement', 'speculation'].includes(claim.kind) ||
        typeof claim.disputed !== 'boolean' || !Array.isArray(claim.sources) || claim.sources.length > 3) throw new Error('Niepoprawne twierdzenie researchu.');
    if (claim.disputed) { warnings.add(`Sprzeczne źródła; nie potwierdzono: ${claim.text}`); continue; }
    const effectiveOn = validDate(claim.effectiveOn);
    if (claim.effectiveOn !== null && !effectiveOn) throw new Error('Niepoprawna data wydarzenia.');
    if (effectiveOn > asOf && claim.kind === 'fact') {
      warnings.add('Przyszłego wydarzenia nie wolno przedstawiać jako wdrożonego faktu.'); continue;
    }
    let sources = claim.sources.map(source).filter(Boolean).filter(item => item.supports === claim.topic);
    if (claim.kind === 'fact' && ['live', 'auec'].includes(claim.topic)) {
      sources = sources.filter(item => !/\b(?:e?ptu|tech[ -]?preview)\b/i.test(item.version ?? ''));
    }
    // Flight Ready/LIVE nie jest dowodem sprzedaży za aUEC.
    if (claim.topic === 'auec') sources = sources.filter(item => /auec|in[ -]game\s+(?:purchase|sale|shop)|(?:buy|purchas\w*|kup\w*)[\s\S]{0,50}(?:in[ -]game|w grze)/iu.test(item.evidence));
    if (claim.kind === 'fact') sources = sources.filter(item => item.origin !== 'leak');
    const current = !timeSensitive || sources.some(item => fresh(item, claim.kind));
    if (timeSensitive && (phase === 'current' || current)) sources = sources.filter(item => fresh(item, claim.kind));
    if (!sources.length) continue;
    claims.push({ ...claim, effectiveOn, sources, freshness: current ? 'current' : 'historical' });
  }
  return { asOf, question: query, timeSensitive, liveVersion,
    liveVersionSource: liveVersion ? versionSource : null, phase, claims,
    gaps: [...data.gaps.filter(gap => typeof gap === 'string').map(gap => gap.slice(0, 300)), ...warnings],
    hasCurrentEvidence: claims.some(claim => claim.freshness === 'current' && claim.kind !== 'speculation'),
  };
}

module.exports = { evidenceFormat, validateEvidence, isTimeSensitive };
