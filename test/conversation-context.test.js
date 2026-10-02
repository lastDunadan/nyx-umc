const assert = require('node:assert/strict');
const { test } = require('node:test');

// Testujemy wywołania i ciągłość kontekstu bez Discorda, API i rzeczywistej bazy.
const memoryPath = require.resolve('../modules/memory');
require.cache[memoryPath] = {
  id: memoryPath, filename: memoryPath, loaded: true,
  exports: {
    MESSAGE_TTL_MS: 12 * 60 * 60 * 1000,
    getRecentExchanges: () => [],
    getRelationship: () => ({ opinion: 'Neutralna.', offended: false, sympathy: 3 }),
    saveRelationship: () => {},
    saveExchange: () => true,
    acceptApology: () => ({ accepted: false }),
    applySympathyEvent: () => ({ applied: true, sympathy: 3, delta: 0, streakDelta: 0 }),
    getRecentMessageScoreSum: () => 0,
  },
};
const errorsPath = require.resolve('../modules/errors-handler');
require.cache[errorsPath] = {
  id: errorsPath, filename: errorsPath, loaded: true,
  exports: async (error) => { throw error; },
};
const createConversationHandler = require('../modules/conversation');

test('Kontynuacja, zmiana modułów, izolacja użytkowników, limit tur i TTL', async () => {
  const calls = [];
  const state = {
    conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map(),
  };
  const respond = createConversationHandler({
    discord: { user: { id: 'nyx' } }, state, memoryDb: {},
    personality: {
      basePrompt: 'CORE_IDENTITY',
      contextModules: ['umc', 'ships', 'humor'].map((id) => ({
        id, title: id, content: `${id.toUpperCase()}_MODULE`,
      })),
    },
    openai: { responses: { create: async (request) => {
      calls.push(request);
      return {
        id: `response-${calls.length}`,
        output: calls.length === 1 ? [{ type: 'web_search_call' }] : [],
        output_text: JSON.stringify({
          reply: 'Odpowiedź.', opinion: 'Neutralna.', containsPersonalData: false,
          isOffensive: false, calledNyxMachine: false, flirtsWithNyx: false,
          apologizesToNyx: false, sympathyPoints: 0,
        }),
      };
    } } },
  });
  async function send(content, userId = 'first', channelId = 'channel') {
    await respond({
      id: `message-${calls.length}`, content, guild: { id: 'guild' },
      author: { id: userId, username: userId },
      channel: { id: channelId, sendTyping: async () => {}, send: async () => {} },
      reply: async () => {}, react: async () => {},
    }, false);
    return calls.at(-1);
  }

  let request = await send('Co lubisz w Argo?');
  assert.equal(request.previous_response_id, undefined);
  assert.match(request.instructions, /CORE_IDENTITY/);
  assert.match(request.instructions, /SHIPS_MODULE/);
  assert.doesNotMatch(request.instructions, /UMC_MODULE|HUMOR_MODULE/);

  request = await send('Dzięki za wyszukiwanie.');
  assert.equal(request.previous_response_id, undefined);
  assert.match(request.instructions, /użyła wyszukiwania: true/);

  await send('Co lubisz w Argo?');
  request = await send('Co lubisz w Argo?', 'second');
  assert.equal(request.previous_response_id, undefined);
  request = await send('Nyx, tylko tyle?');
  assert.equal(request.previous_response_id, 'response-3');

  request = await send('Opowiedz o UMC.');
  assert.equal(request.previous_response_id, undefined);
  assert.match(request.instructions, /UMC_MODULE/);
  assert.doesNotMatch(request.instructions, /SHIPS_MODULE/);
  request = await send('Opowiedz więcej.');
  assert.equal(request.previous_response_id, 'response-6');

  request = await send('Jaką muzykę lubisz?');
  assert.equal(request.previous_response_id, undefined);
  assert.doesNotMatch(request.instructions, /SHIPS_MODULE|UMC_MODULE|HUMOR_MODULE/);

  await send('Co lubisz w Argo?');
  request = await send('Tylko tyle?', 'first', 'other-channel');
  assert.equal(request.previous_response_id, undefined);
  assert.doesNotMatch(request.instructions, /SHIPS_MODULE/);

  const previous = state.conversations.get('guild:channel:first');
  previous.turns = 8;
  request = await send('Tylko tyle?');
  assert.equal(request.previous_response_id, undefined);
  assert.match(request.instructions, /SHIPS_MODULE/);

  state.conversations.get('guild:channel:first').lastActivityAt -= 13 * 60 * 60 * 1000;
  request = await send('Tylko tyle?');
  assert.equal(request.previous_response_id, undefined);
  assert.doesNotMatch(request.instructions, /SHIPS_MODULE/);
  assert.equal(calls.length, 12);
});
