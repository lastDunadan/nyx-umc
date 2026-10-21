const fs = require('node:fs');
const path = require('node:path');
const { evidenceFormat, validateEvidence } = require('./research-evidence');

const basicPrompt = fs.readFileSync(
  path.join(__dirname, '..', 'personality', 'basic-personality.txt'), 'utf8'
).trim();
const RESEARCH_TOOL = {
  type: 'function', name: 'research_web', strict: true,
  description: 'Sprawdź aktualne fakty i źródła w internecie. Podaj dokładny przedmiot (np. Railen), potrzebny status i wersję, bez danych rozmówcy. Zwraca twierdzenia z dowodami, datami i linkami; starsze informacje są oznaczone.',
  parameters: {
    type: 'object', properties: { query: { type: 'string' } },
    required: ['query'], additionalProperties: false,
  },
};

// Surowe wyniki wyszukiwania pozostają w osobnym wywołaniu bez historii i lore.
async function createResearchedResponse(openai, request, { beforeResearch, now = () => new Date() } = {}) {
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
      if (researchCalls === 0 && beforeResearch) await beforeResearch();
      const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
      async function research(phase) {
        researchCalls++;
        const facts = await openai.responses.create({
          model: request.model, instructions: basicPrompt,
          input: `Data sprawdzenia: ${asOf}\nBieżący rok: ${asOf.slice(0, 4)}\nEtap: ${phase}\n` +
            (phase === 'current' ? 'Najpierw szukaj dowodów obecnego stanu z bieżącego roku i obecnego LIVE. Starsze źródła dla zmiennych faktów pomiń na tym etapie.\n'
              : 'W pierwszym etapie nie uzyskano świeżego potwierdzenia. Sprawdź ponownie bieżący stan; możesz podać starsze materiały wyłącznie jako stan historyczny, z datą i ograniczeniem.\n') +
            `Pytanie: ${query}`,
          reasoning: { effort: 'low' },
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          include: ['web_search_call.action.sources'],
          text: { format: evidenceFormat },
          tool_choice: 'required', max_output_tokens: 2400,
        });
        count(facts);
        if (!facts.output_text?.trim() || facts.status === 'incomplete' || facts.output_text.length > 16000) {
          throw new Error('Wyszukiwanie nie zwróciło kompletnego, krótkiego wyniku.');
        }
        return validateEvidence(facts, { query, asOf, phase });
      }
      let evidence = await research('current');
      if (evidence.timeSensitive && !evidence.hasCurrentEvidence && researchCalls < 2) {
        const fallback = await research('historical');
        evidence = { ...fallback, freshSearchFailed: true,
          gaps: [...new Set([...evidence.gaps, ...fallback.gaps])].slice(0, 8) };
      }
      if (!evidence.claims.length) evidence.gaps.push('Nie potwierdzono odpowiedzi na to pytanie w dostępnych źródłach.');
      // Jawna lista twierdzeń i dowodów, bez całych stron i surowych wyników.
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(evidence) });
    }
    current = {
      ...request, tools: [RESEARCH_TOOL], parallel_tool_calls: false,
      instructions: `${request.instructions ?? ''}\nRESEARCH: korzystaj wyłącznie z twierdzeń i źródeł przekazanych przez research_web. Brak dowodu oznacza brak potwierdzenia, nie fakt negatywny. Trzymaj się question; nie podmieniaj statku lub tematu na starszą rozmowę. Historical nie potwierdza obecnego stanu: podaj datę, wersję i ograniczenie. Community/leak nazywaj odpowiednio relacją społeczności/spekulacją. Nie utożsamiaj konceptu, Flight Ready, LIVE i zakupu za aUEC. Nie dopisuj ceny ani dostępności bez odrębnego dowodu. Przy sprzecznych źródłach opisz niepewność. Cytuj bezpośrednie URL przy wspieranych twierdzeniach, bez wynajdywania nowych linków lub faktów.`,
      previous_response_id: response.id, input: outputs,
      // Po dwóch wyszukiwaniach model ma przygotować odpowiedź zamiast szukać bez końca.
      tool_choice: researchCalls >= 2 ? 'none' : 'auto',
    };
  }
  throw new Error('Nie udało się zakończyć odpowiedzi po wyszukiwaniu.');
}

module.exports = { createResearchedResponse, basicPrompt };
