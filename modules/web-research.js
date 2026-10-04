const fs = require('node:fs');
const path = require('node:path');

const basicPrompt = fs.readFileSync(
  path.join(__dirname, '..', 'personality', 'basic-personality.txt'), 'utf8'
).trim();
const RESEARCH_TOOL = {
  type: 'function', name: 'research_web', strict: true,
  description: 'Sprawdź aktualne fakty i źródła w internecie. Przekaż samodzielne pytanie bez danych rozmówcy. Wynik zawiera ustalenia i linki, nie osobowość Nyx.',
  parameters: {
    type: 'object', properties: { query: { type: 'string' } },
    required: ['query'], additionalProperties: false,
  },
};

// Surowe wyniki wyszukiwania pozostają w osobnym wywołaniu bez historii i lore.
async function createResearchedResponse(openai, request) {
  let response;
  let searches = 0;
  let researchCalls = 0;
  const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
  function count(result) {
    usage.input_tokens += result.usage?.input_tokens ?? 0;
    usage.output_tokens += result.usage?.output_tokens ?? 0;
    usage.cached_tokens += result.usage?.input_tokens_details?.cached_tokens ?? 0;
    searches += result.output?.filter((item) => item.type === 'web_search_call').length ?? 0;
  }
  let current = { ...request, tools: [RESEARCH_TOOL], parallel_tool_calls: false };
  for (let round = 0; round < 3; round++) {
    response = await openai.responses.create(current);
    count(response);
    const calls = response.output?.filter((item) => item.type === 'function_call') ?? [];
    if (!calls.length) return { response, searches, researchCalls, usage };
    const outputs = [];
    for (const call of calls) {
      if (call.name !== 'research_web' || researchCalls >= 2) {
        throw new Error('Przekroczono limit zapytań research_web lub nieznane narzędzie.');
      }
      const { query } = JSON.parse(call.arguments);
      if (typeof query !== 'string' || !query.trim() || query.length > 1000) {
        throw new Error('Niepoprawne pytanie do research_web.');
      }
      researchCalls++;
      const facts = await openai.responses.create({
        model: request.model, instructions: basicPrompt,
        input: `Data sprawdzenia: ${new Date().toISOString().slice(0, 10)}\nPytanie: ${query}`,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        tool_choice: 'required', max_output_tokens: 1600,
      });
      count(facts);
      // Nie przekazujemy modelowi Nyx całych stron ani wewnętrznych wywołań web_search.
      const text = facts.output_text?.trim();
      if (!text || facts.status === 'incomplete' || text.length > 6000) {
        throw new Error('Wyszukiwanie nie zwróciło kompletnego, krótkiego wyniku.');
      }
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: text });
    }
    current = {
      ...request, tools: [RESEARCH_TOOL], parallel_tool_calls: false,
      previous_response_id: response.id, input: outputs,
      // Po dwóch wyszukiwaniach model ma przygotować odpowiedź zamiast szukać bez końca.
      tool_choice: researchCalls >= 2 ? 'none' : 'auto',
    };
  }
  throw new Error('Nie udało się zakończyć odpowiedzi po wyszukiwaniu.');
}

module.exports = { createResearchedResponse, basicPrompt };
