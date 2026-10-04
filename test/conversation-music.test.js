const assert = require('node:assert/strict');
const { test } = require('node:test');

const saved = [];
let sympathy = 3;
const memoryPath = require.resolve('../modules/memory');
require.cache[memoryPath] = {
  id: memoryPath, filename: memoryPath, loaded: true,
  exports: {
    MESSAGE_TTL_MS: 12 * 60 * 60 * 1000,
    getRecentExchanges: () => [],
    getRelationship: () => ({ opinion: 'Neutralna.', offended: false, sympathy }),
    saveRelationship: () => {},
    saveExchange: (_db, exchange) => { saved.push(exchange); return true; },
    acceptApology: () => ({ accepted: false }),
    applySympathyEvent: () => ({ applied: true, sympathy, delta: 0, streakDelta: 0 }),
    getRecentMessageScoreSum: () => 0,
  },
};
const errorsPath = require.resolve('../modules/errors-handler');
require.cache[errorsPath] = {
  id: errorsPath, filename: errorsPath, loaded: true,
  exports: async (error) => { throw error; },
};
const createConversationHandler = require('../modules/conversation');
const { MUSIC_TRACKS } = require('../modules/music');
const personality = require('../modules/personality');

test('Muzyka: zatwierdzone linki, pamięć, izolacja, zmiana tematu i odmowa', async () => {
  const calls = [];
  const delivered = [];
  const state = {
    conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map(),
  };
  let mode = 'recommend';
  const respond = createConversationHandler({
    discord: { user: { id: 'nyx' } }, state, memoryDb: {}, stickerSender: async () => false, personality,
    openai: { responses: { create: async (request) => {
      calls.push(request);
      const schema = request.text.format.schema;
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      const ids = schema.properties.musicTrackId.enum;
      assert.ok(ids.length <= 6);
      const musicTrackId = mode === 'invalid' ? 'invented-track'
        : mode === 'recommend' ? ids[1] ?? '' : '';
      return {
        id: `response-${calls.length}`, output: [],
        output_text: JSON.stringify({
          reply: 'Odpowiedź.', opinion: 'Neutralna.', containsPersonalData: false,
          isOffensive: false, calledNyxMachine: false, flirtsWithNyx: false,
          apologizesToNyx: false, sympathyPoints: 0, musicTrackId,
        }),
      };
    } } },
  });
  async function send(content, userId = 'first') {
    await respond({
      id: `message-${calls.length}`, content, guild: { id: 'guild' },
      author: { id: userId, username: userId },
      channel: { id: 'channel', sendTyping: async () => {}, send: async ({ content: answer }) => { delivered.push(answer); } },
      reply: async ({ content: answer }) => { delivered.push(answer); }, react: async () => {},
    }, false);
    return calls.at(-1);
  }

  let request = await send('Nyx, jaka jest Twoja ulubiona piosenka?');
  const favorite = MUSIC_TRACKS.find(({ id }) => id === 'lost-boy');
  assert.equal(request.text.format.schema.properties.musicTrackId.enum[1], favorite.id);
  assert.ok(delivered.at(-1).includes(favorite.youtubeUrl));
  assert.equal(saved.at(-1).response, delivered.at(-1));
  assert.ok(!request.instructions.includes(favorite.youtubeUrl));
  assert.deepEqual(state.conversations.get('guild:channel:first').musicTrackIds, ['lost-boy']);

  request = await send('Daj coś innego.');
  assert.equal(request.previous_response_id, 'response-1');
  assert.ok(!request.text.format.schema.properties.musicTrackId.enum.includes('lost-boy'));

  request = await send('Daj coś innego.', 'second');
  assert.equal(request.previous_response_id, undefined);
  assert.deepEqual(request.text.format.schema.properties.musicTrackId.enum, ['']);
  assert.equal(delivered.at(-1), 'Odpowiedź.');

  request = await send('Co lubisz w Argo?');
  assert.equal(request.previous_response_id, undefined);
  assert.deepEqual(request.text.format.schema.properties.musicTrackId.enum, ['']);
  assert.ok(!request.instructions.includes(personality.musicInfo));

  mode = 'decline';
  sympathy = -17;
  await send('Poleć piosenkę!');
  assert.equal(delivered.at(-1), 'Odpowiedź.');

  mode = 'invalid';
  sympathy = 3;
  await send('Poleć utwór');
  assert.equal(delivered.at(-1), 'Odpowiedź.');

  const callCount = calls.length;
  sympathy = -20;
  await send('Poleć piosenkę!');
  assert.equal(calls.length, callCount);
  assert.ok(!delivered.at(-1).includes('youtu.be'));
});
