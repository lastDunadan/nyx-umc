const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openMemory, saveRelationship, getRelationship } = require('../modules/memory');
const createConversationHandler = require('../modules/conversation');

for (const scenario of [
  { before: 19, points: 1, situation: 'none', sticker: 'wink', replies: 1 },
  { before: -19, points: -2, situation: 'none', sticker: 'angry', replies: 1 },
  { before: -7, points: 0, situation: 'sulk', sticker: 'sulk', replies: 0 },
  { before: 15, points: 2, situation: 'thumbup', sticker: 'thumbup', replies: 1 },
]) {
  test(`Rozmowa: ${scenario.sticker}, naliczanie punktów i zastąpienie tekstu/emoji`, async () => {
    const db = openMemory({ file: ':memory:' });
    try {
      saveRelationship(db, { userId: 'u', displayName: 'Tester', opinion: '', containsPersonalData: false });
      db.prepare('UPDATE users SET sympathy = ? WHERE user_id = ?').run(scenario.before, 'u');
      const replies = [], reactions = [], stickers = [];
      const respond = createConversationHandler({ memoryDb: db,
        discord: { user: { id: 'nyx' } },
        state: { conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map() },
        personality: { basePrompt: 'CORE', contextModules: [] },
        stickerSender: async (message, id, options) => { if (options.turn.sent) return false;
          options.turn.sent = true; stickers.push(id); return true; },
        openai: { responses: { create: async () => ({ id: 'r', output: [], usage: {}, output_text: JSON.stringify({
          reply: 'Odpowiedź', opinion: '', containsPersonalData: false, isOffensive: scenario.points < 0,
          sympathyPoints: scenario.points, calledNyxMachine: false, flirtsWithNyx: false,
          apologizesToNyx: false, musicTrackId: '', stickerSituation: scenario.situation,
        }) }) } },
      });
      await respond({ content: 'Bardzo konkretna pochwała wykonanej pracy. '.repeat(4), id: 'm',
        guild: { id: 'g' }, author: { id: 'u', username: 'Tester' },
        channel: { id: 'c', sendTyping: async () => {}, send: async o => replies.push(o) },
        reply: async o => replies.push(o), react: async o => reactions.push(o),
      }, false);
      assert.deepEqual(stickers, [scenario.sticker]);
      assert.equal(replies.length, scenario.replies);
      assert.equal(reactions.length, 0);
      assert.equal(getRelationship(db, 'u').sympathy, Math.max(-20, Math.min(20, scenario.before + scenario.points)));
    } finally { db.close(); }
  });
}
