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
    discord: { user: { id: 'nyx' } }, state, memoryDb: {}, stickerSender: async () => false,
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
          musicTrackId: '',
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

test('Rozmowa dołącza gust broni na żądanie i usuwa go po zmianie tematu', async () => {
  const personality = require('../modules/personality');
  const calls = [];
  const state = {
    conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map(),
  };
  const respond = createConversationHandler({
    discord: { user: { id: 'nyx' } }, state, personality, memoryDb: {}, stickerSender: async () => false,
    openai: { responses: { create: async (request) => {
      calls.push(request);
      return {
        id: `weapons-response-${calls.length}`, output: [],
        output_text: JSON.stringify({
          reply: 'Odpowiedź.', opinion: 'Neutralna.', containsPersonalData: false,
          isOffensive: false, calledNyxMachine: false, flirtsWithNyx: false,
          apologizesToNyx: false, sympathyPoints: 0, musicTrackId: '',
        }),
      };
    } } },
  });
  async function send(content) {
    await respond({
      id: `weapons-message-${calls.length}`, content, guild: { id: 'guild' },
      author: { id: 'first', username: 'first' },
      channel: { id: 'channel', sendTyping: async () => {}, send: async () => {} },
      reply: async () => {}, react: async () => {},
    }, false);
    return calls.at(-1);
  }

  let request = await send('Nyx, jaka jest Twoja ulubiona broń?');
  assert.ok(request.instructions.includes(personality.weaponPrefs));
  assert.ok(!request.instructions.includes(personality.shipPrefs));
  assert.equal(request.previous_response_id, undefined);
  assert.deepEqual(request.text.format.schema.properties.musicTrackId.enum, ['']);

  request = await send('Tylko tyle?');
  assert.equal(request.previous_response_id, 'weapons-response-1');
  assert.ok(request.instructions.includes(personality.weaponPrefs));
  request = await send('Poleć loadout.');
  assert.equal(request.previous_response_id, 'weapons-response-2');

  request = await send('Jaką broń dobrać do Arrowa?');
  assert.equal(request.previous_response_id, undefined);
  assert.ok(!request.instructions.includes(personality.weaponPrefs));
  assert.ok(request.instructions.includes(personality.shipPrefs));

  request = await send('Jaką muzykę lubisz?');
  assert.equal(request.previous_response_id, undefined);
  assert.ok(request.instructions.includes(personality.musicInfo));
  assert.ok(!request.instructions.includes(personality.weaponPrefs));
});


test('Wyszukiwanie i duże wejście nie przechodzą do następnego łańcucha', async () => {
  const calls = [];
  const state = { conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map() };
  const respond = createConversationHandler({
    discord: { user: { id: 'nyx' } }, state, memoryDb: {}, stickerSender: async () => false,
    personality: { basePrompt: 'CORE', contextModules: [{ id: 'ships', title: 'ships', content: 'SHIPS' }] },
    openai: { responses: { create: async request => {
      calls.push(request);
      return { id: `chain-${calls.length}`, output: [], usage: { input_tokens: 100 },
        output_text: JSON.stringify({ reply: 'Odpowiedź.', opinion: 'Neutralna.', containsPersonalData: false,
          isOffensive: false, calledNyxMachine: false, flirtsWithNyx: false,
          apologizesToNyx: false, sympathyPoints: 0, musicTrackId: '' }) };
    } } },
  });
  const send = () => respond({ id: `message-${calls.length}`, content: 'Co lubisz w Argo?',
    guild: { id: 'g' }, author: { id: 'u', username: 'u' },
    channel: { id: 'c', sendTyping: async () => {}, send: async () => {} }, reply: async () => {}, react: async () => {},
  }, false);
  await send();
  state.conversations.get('g:c:u').usedWebSearch = true;
  await send();
  assert.equal(calls[1].previous_response_id, undefined);
  state.conversations.get('g:c:u').chainInputTokens = 12000;
  await send();
  assert.equal(calls[2].previous_response_id, undefined);
  state.conversations.get('g:c:u').turns = 4;
  await send();
  assert.equal(calls[3].previous_response_id, undefined);
});

test('Ankieta zakupu: werdykt kodu, kontynuacja, izolacja i brak narzucania jej opiniom', async () => {
  const personality = require('../modules/personality');
  const state = { conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map() };
  const calls = [];
  const delivered = [];
  let answers = {};
  let intent = true;
  const respond = createConversationHandler({
    discord: { user: { id: 'nyx' } }, state, personality, memoryDb: {}, stickerSender: async () => false,
    openai: { responses: { create: async request => {
      calls.push(request);
      const schema = request.text.format.schema;
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      return { id: `project-${calls.length}`, output: [], output_text: JSON.stringify({
        reply: 'Moja opinia o projekcie.', opinion: 'Neutralna.', containsPersonalData: false,
        isOffensive: false, calledNyxMachine: false, flirtsWithNyx: false,
        apologizesToNyx: false, sympathyPoints: 0, musicTrackId: '',
        purchaseIntent: intent, purchaseAnswers: answers,
      }) };
    } } },
  });
  const send = async (content, userId = 'first') => {
    await respond({ id: `message-${calls.length}`, content, guild: { id: 'g' },
      author: { id: userId, username: userId }, channel: { id: 'c', sendTyping: async () => {}, send: async () => {} },
      reply: async ({ content }) => delivered.push(content), react: async () => {},
    }, false);
    return delivered.at(-1);
  };
  assert.match(await send('Czy warto kupić SC?'), /Na razie nie/);
  intent = false; answers = { scienceFiction: 'yes' };
  assert.match(await send('1. tak'), /Na razie nie/);
  answers = { acceptsRisk: 'yes' };
  assert.match(await send('2. tak'), /^Tak,/);
  answers = {};
  assert.equal(await send('Co myślisz o Chrisie Robertsie?'), 'Moja opinia o projekcie.');
  assert.equal(await send('Tak.', 'other'), 'Moja opinia o projekcie.');
  assert.equal(calls.at(-1).text.format.schema.properties.purchaseAnswers, undefined);
  await send('Jaka jest twoja ulubiona broń?');
  assert.equal(calls.at(-1).text.format.schema.properties.purchaseIntent, undefined);
  assert.equal(state.conversations.get('g:c:first').purchaseSurvey, null);
});
