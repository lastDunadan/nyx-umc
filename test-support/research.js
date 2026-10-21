function researchResult({ date = new Date().toISOString().slice(0, 10), topic = 'general',
  text = 'Sprawdzony fakt.', origin = 'official', url = 'https://robertsspaceindustries.com/en/source',
  evidence = 'Sprawdzony stan w bieżącym LIVE.', version = null, timeSensitive = true,
  kind = 'fact', effectiveOn = null, disputed = false, retrieved = true, opened = true,
  liveVersion = null, liveVersionSource = null, gaps = [] } = {}) {
  const source = { url, publishedOn: date, version, origin, supports: topic, evidence };
  return { output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: retrieved ? [{ url }] : [] } },
    ...(opened ? [{ type: 'web_search_call', status: 'completed', action: { type: 'open_page', url } }] : []),
  ], output_text: JSON.stringify({ timeSensitive, liveVersion, liveVersionSource,
    claims: [{ text, topic, kind, disputed, effectiveOn, sources: [source] }], gaps }) };
}
module.exports = { researchResult };
