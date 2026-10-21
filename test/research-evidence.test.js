const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEvidence } = require('../modules/research-evidence');
const { createResearchedResponse } = require('../modules/web-research');
const { researchResult } = require('../test-support/research');
const options = { query: 'Aktualna dostępność Railena za aUEC w LIVE', asOf: '2026-10-06' };
const current = extra => researchResult({ date: options.asOf, ...extra });
function modify(result, edit) { const data = JSON.parse(result.output_text); edit(data); result.output_text = JSON.stringify(data); return result; }

test('Zmienne fakty: current odrzuca stare i bezdatowe źródła; historyczne dopiero w fallback', () => {
  for (const date of ['2025-10-06', null]) {
    const result = current({ date });
    assert.equal(validateEvidence(result, options).claims.length, 0);
    const old = validateEvidence(result, { ...options, phase: 'historical' });
    assert.equal(old.claims.length, 1);
    assert.equal(old.claims[0].freshness, 'historical');
    assert.equal(old.claims[0].sources[0].publishedOn, date);
  }
  assert.equal(validateEvidence(current(), options).hasCurrentEvidence, true);
  const lore = validateEvidence(current({ date: '2020-01-01', timeSensitive: false }), { ...options, query: 'Historia fikcyjnej cywilizacji Xi’an' });
  assert.equal(lore.claims.length, 1);
});

test('Nie przyjmuje zmyślonego URL, daty, przyszłej publikacji ani nieotwartego oficjalnego oryginału', () => {
  for (const result of [current({ retrieved: false, opened: false }), current({ opened: false }),
    current({ date: '2026-02-30' }), current({ date: '2027-01-01' }),
    current({ url: 'https://robertsspaceindustries.com.evil.example/source' })]) {
    assert.equal(validateEvidence(result, options).claims.length, 0);
  }
  const failed = current(); failed.output[1].status = 'failed';
  assert.equal(validateEvidence(failed, options).claims.length, 0);
  const indirect = validateEvidence(current({ url: 'https://www.reddit.com/r/starcitizen/report', origin: 'community', opened: false }), options);
  assert.equal(indirect.claims[0].sources[0].origin, 'community');
});

test('Zakup za aUEC wymaga osobnego dowodu; Flight Ready i LIVE nie wystarczają', () => {
  const flightReady = current({ topic: 'auec', evidence: 'The ship is Flight Ready and available in LIVE.' });
  assert.equal(validateEvidence(flightReady, options).claims.length, 0);
  const mismatched = modify(current({ topic: 'auec', evidence: 'Buy the ship for 1000000 aUEC.' }), data => { data.claims[0].sources[0].supports = 'flight_ready'; });
  assert.equal(validateEvidence(mismatched, options).claims.length, 0);
  const purchase = validateEvidence(current({ topic: 'auec', evidence: 'Purchase Railen for 1000000 aUEC.' }), options);
  assert.equal(purchase.claims[0].topic, 'auec');
  const ptu = current({ topic: 'live', version: '4.10.1-PTU' });
  assert.equal(validateEvidence(ptu, options).claims.length, 0);
});

test('Zapowiedź przyszłości nie jest faktem; przeciek i sprzeczne źródła nie dają potwierdzenia', () => {
  assert.equal(validateEvidence(current({ effectiveOn: '2026-12-01' }), options).claims.length, 0);
  assert.equal(validateEvidence(current({ effectiveOn: '2026-12-01', kind: 'announcement' }), options).claims[0].kind, 'announcement');
  const leak = current({ url: 'https://www.reddit.com/r/Starcitizen_Leaks/report', origin: 'leak', opened: false });
  assert.equal(validateEvidence(leak, options).claims.length, 0);
  modify(leak, data => { data.claims[0].kind = 'speculation'; });
  const speculation = validateEvidence(leak, options);
  assert.equal(speculation.claims.length, 1); assert.equal(speculation.hasCurrentEvidence, false);
  const disputed = validateEvidence(current({ disputed: true }), options);
  assert.equal(disputed.claims.length, 0); assert.match(disputed.gaps.join(), /Sprzeczne/);
});

test('Bezdatowa baza wymaga zgodnego patcha oraz oddzielnego świeżego dowodu obecnej wersji', () => {
  const result = current({ url: 'https://sc-community.example/ships/rail en', origin: 'community', opened: false,
    date: null, topic: 'auec', evidence: 'Railen costs 1000000 aUEC.', version: '4.10.1-LIVE', liveVersion: '4.10.1-LIVE' });
  assert.equal(validateEvidence(result, options).claims.length, 0);
  const versionUrl = 'https://robertsspaceindustries.com/en/comm-link/patch-notes';
  modify(result, data => { data.liveVersionSource = { url: versionUrl, publishedOn: options.asOf,
    origin: 'official', version: '4.10.1-LIVE', supports: 'live', evidence: 'LIVE version 4.10.1.' }; });
  result.output.push({ type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: versionUrl } });
  assert.equal(validateEvidence(result, options).claims.length, 1);
  modify(result, data => { data.claims[0].sources[0].version = '3.24-LIVE'; });
  assert.equal(validateEvidence(result, options).claims.length, 0);
  modify(result, data => { data.claims[0].sources[0].publishedOn = options.asOf; });
  assert.equal(validateEvidence(result, options).claims.length, 0); // świeża publikacja, stary patch
});

test('Świeży dowód wypiera starszy nawet w fallback; brak lub błędny JSON nie potwierdza faktów', () => {
  const result = current();
  modify(result, data => { data.claims[0].sources.push({ ...data.claims[0].sources[0], publishedOn: '2025-01-01' }); });
  assert.equal(validateEvidence(result, { ...options, phase: 'historical' }).claims[0].sources.length, 1);
  assert.throws(() => validateEvidence({ output_text: 'Nie-JSON' }, options));
});

test('Pipeline: najpierw bieżący rok, potem historyczny fallback, jeden focus i maksymalnie dwa badania', async () => {
  const calls = []; let focused = 0;
  const results = [
    { id: 'plan', output: [{ type: 'function_call', name: 'research_web', call_id: 'rail en', arguments: JSON.stringify({ query: options.query }) }] },
    current({ date: '2025-01-01' }), current({ date: '2025-01-01' }),
    { id: 'answer', output: [], output_text: '{}' },
  ];
  const result = await createResearchedResponse({ responses: { create: async request => { calls.push(request); return results.shift(); } } },
    { model: 'gpt-6-luna', instructions: 'CORE', input: 'Pytanie' },
    { now: () => new Date(`${options.asOf}T10:00:00Z`), beforeResearch: async () => focused++ });
  assert.equal(result.researchCalls, 2); assert.equal(focused, 1);
  assert.match(calls[1].input, /Bieżący rok: 2026\nEtap: current/);
  assert.match(calls[2].input, /Etap: historical/);
  assert.equal(calls[3].tool_choice, 'none');
  const report = JSON.parse(calls[3].input[0].output);
  assert.equal(report.question, options.query);
  assert.equal(report.claims[0].freshness, 'historical');
  assert.equal(report.freshSearchFailed, true);
  assert.match(calls[3].instructions, /Nie utożsamiaj konceptu/);
});

test('Pipeline bez wiarygodnego źródła przekazuje niepewność, nie wymyślone potwierdzenie', async () => {
  const calls = [];
  const results = [{ id: 'p', output: [{ type: 'function_call', name: 'research_web', call_id: 'c', arguments: JSON.stringify({ query: options.query }) }] },
    current({ opened: false }), current({ opened: false }), { id: 'f', output: [] }];
  await createResearchedResponse({ responses: { create: async request => { calls.push(request); return results.shift(); } } },
    { model: 'gpt-6-luna', input: 'Pytanie' }, { now: () => new Date(`${options.asOf}T10:00:00Z`) });
  const report = JSON.parse(calls.at(-1).input[0].output);
  assert.equal(report.claims.length, 0);
  assert.match(report.gaps.join(), /Nie potwierdzono odpowiedzi/);
});

test('Rok i data researchu zmieniają się o polskiej północy, nie dopiero o północy UTC', async () => {
  const calls = [];
  const results = [{ id: 'p', output: [{ type: 'function_call', name: 'research_web', call_id: 'c', arguments: JSON.stringify({ query: options.query }) }] },
    current({ date: '2027-01-01' }), { id: 'f', output: [] }];
  await createResearchedResponse({ responses: { create: async request => { calls.push(request); return results.shift(); } } },
    { model: 'gpt-6-luna', input: 'Pytanie' }, { now: () => new Date('2026-12-31T23:05:00Z') });
  assert.match(calls[1].input, /Data sprawdzenia: 2027-01-01\nBieżący rok: 2027/);
  assert.equal(JSON.parse(calls[2].input[0].output).claims.length, 1);
});
