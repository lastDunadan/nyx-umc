const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createResearchedResponse, basicPrompt } = require('../modules/web-research');
const personality = require('../modules/personality');
const { researchResult } = require('../test-support/research');

const functionCall = (id) => ({ type: 'function_call', name: 'research_web', call_id: id,
  arguments: JSON.stringify({ query: 'Aktualna dostępność R97 w LIVE Star Citizen' }) });
const request = { model: 'gpt-6-luna', instructions: 'FULL_IDENTITY SYMPATHY PRIVATE_HISTORY',
  input: 'Pytanie użytkownika', text: { format: {} }, tool_choice: 'auto' };

test('Wyszukiwanie ma krótki prompt i żadnej tożsamości, historii ani previous_response_id', async () => {
  const calls = [];
  const results = [
    { id: 'plan', output: [functionCall('call-1')], usage: { input_tokens: 100, output_tokens: 10 } },
    { id: 'facts', ...researchResult(), usage: { input_tokens: 200, output_tokens: 20 } },
    { id: 'final', output: [], output_text: '{"reply":"Odpowiedź"}', usage: { input_tokens: 300, output_tokens: 30 } },
  ];
  const result = await createResearchedResponse({ responses: { create: async (r) => { calls.push(r); return results.shift(); } } }, request);
  assert.equal(calls[0].tools[0].name, 'research_web');
  assert.equal(calls[1].instructions, basicPrompt);
  assert.equal(calls[1].previous_response_id, undefined);
  assert.equal(calls[1].text.format.type, 'json_schema');
  assert.deepEqual(calls[1].include, ['web_search_call.action.sources']);
  assert.equal(calls[1].tools[0].type, 'web_search');
  assert.equal(calls[1].tools[0].search_context_size, 'low');
  assert.equal(calls[1].tool_choice, 'required');
  assert.doesNotMatch(JSON.stringify(calls[1]), /FULL_IDENTITY|SYMPATHY|PRIVATE_HISTORY|weaponPrefs/);
  assert.equal(calls[2].previous_response_id, 'plan');
  assert.equal(calls[2].input[0].call_id, 'call-1');
  assert.match(calls[2].input[0].output, /https:\/\//);
  assert.equal(result.response.id, 'final');
  assert.equal(result.searches, 2);
  assert.equal(result.researchCalls, 1);
  assert.equal(result.usage.input_tokens, 600);
});

test('Zwykła rozmowa nie wywołuje osobnego wyszukiwania', async () => {
  let count = 0;
  const result = await createResearchedResponse({ responses: { create: async () => { count++; return { id: 'ok', output: [], output_text: '{}' }; } } }, request);
  assert.equal(count, 1);
  assert.equal(result.researchCalls, 0);
});

test('Limit dwóch zapytań wymusza odpowiedź i chroni przed pętlą', async () => {
  const calls = [];
  const results = [
    { id: 'a', output: [functionCall('one')] }, researchResult(),
    { id: 'b', output: [functionCall('two')] }, researchResult(),
    { id: 'c', output: [], output_text: '{}' },
  ];
  await createResearchedResponse({ responses: { create: async r => { calls.push(r); return results.shift(); } } }, request);
  assert.equal(calls[4].tool_choice, 'none');
  assert.equal(calls.length, 5);
});

test('Niekompletne źródła oraz nieznana funkcja kończą się kontrolowanym błędem', async () => {
  for (const results of [
    [{ id: 'a', output: [functionCall('one')] }, { status: 'incomplete', output_text: 'Ucięte' }],
    [{ id: 'a', output: [{ ...functionCall('one'), name: 'unknown' }] }],
  ]) {
    await assert.rejects(createResearchedResponse({ responses: { create: async () => results.shift() } }, request));
  }
});

test('Skrócony prompt zachowuje akapit o RSI i oddziela instrukcje wyszukiwania', () => {
  const paragraph = 'Gdy powołujesz się na oficjalny komunikat RSI/CIG, podaj bezpośredni link do niego. Jeśli znasz go tylko z relacji społeczności i nie możesz otworzyć oryginału, nazwij to relacją społeczności, nie potwierdzeniem RSI/CIG. Datę przyszłego wydarzenia podawaj wyłącznie jako zapowiedź lub spekulację, zgodnie ze źródłem.';
  assert.ok(personality.prompt.includes(paragraph));
  assert.ok(basicPrompt.includes(paragraph));
  assert.ok(personality.prompt.length < 6000);
  assert.ok(basicPrompt.length < 3500);
  assert.ok(!basicPrompt.includes(personality.identity));
});
