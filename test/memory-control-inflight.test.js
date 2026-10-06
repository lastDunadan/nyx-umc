const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openMemory, getRecentExchanges, saveExchange, getRelationship } = require('../modules/memory');
const { deleteUserExchanges, forgetConversation } = require('../modules/memory-control');
const createConversationHandler = require('../modules/conversation');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

for (const phase of ['API', 'Discord']) {
  test(`Purge podczas oczekiwania na ${phase} nie odtwarza pamięci ani opinii`, async () => {
    const db = openMemory({ file: ':memory:' });
    try {
      saveExchange(db, { userId: 'u', displayName: 'Tester', content: 'stara wymiana', response: 'OK', containsPersonalData: false });
      db.prepare("UPDATE users SET opinion='Stara opinia', sympathy=7 WHERE user_id='u'").run();
      const state = { conversations: new Map(), lastSpontaneousReply: new Map(), lastOffendedReply: new Map() };
      const reached = deferred(), released = deferred();
      const message = { content: 'Cześć Nyx!', id: 'msg', guild: { id: 'guild' },
        author: { id: 'u', username: 'Tester' }, member: { displayName: 'Tester' },
        channel: { id: 'channel', name: 'chat', sendTyping: async () => {}, send: async () => {} },
        reply: async () => { if (phase === 'Discord') { reached.resolve(); await released.promise; } },
        react: async () => {},
      };
      const respond = createConversationHandler({ discord: { user: { id: 'nyx' } }, memoryDb: db, state,
        personality: { basePrompt: 'CORE', contextModules: [] },
        openai: { responses: { create: async () => {
          if (phase === 'API') { reached.resolve(); await released.promise; }
          return { id: 'response', output: [], usage: {}, output_text: JSON.stringify({
            reply: 'Odpowiedź', opinion: 'Nowa opinia', containsPersonalData: false, isOffensive: false,
            sympathyPoints: 2, calledNyxMachine: false, flirtsWithNyx: false, apologizesToNyx: false,
            musicTrackId: '',
          }) };
        } } },
      });
      const pending = respond(message, false);
      await reached.promise;
      deleteUserExchanges(db, 'u'); forgetConversation(state, 'u');
      released.resolve(); await pending;
      assert.equal(getRecentExchanges(db, 'u').length, 0);
      assert.equal(state.conversations.size, 0);
      assert.equal(getRelationship(db, 'u').opinion, 'Stara opinia');
      assert.equal(getRelationship(db, 'u').sympathy, 7);
    } finally { db.close(); }
  });
}
