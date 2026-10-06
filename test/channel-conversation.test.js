const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openMemory, getRelationship } = require('../modules/memory');
const { getChannelHistory, saveChannelMessage, deleteChannelExchanges, deleteAllUserExchanges } = require('../modules/channel-memory');
const { forgetChannelConversation, forgetAllChannelConversations } = require('../modules/memory-control');
const createMessageHandler = require('../modules/messages');
process.env.AI_ACCESS_ROLE_ID = 'access';

function setup(options = {}) {
  const db = openMemory({ file: ':memory:' }), calls = [], replies = [], members = new Map();
  const state = { conversations: new Map(), relationships: new Map(), lastSpontaneousReply: new Map(),
    lastOffendedReply: new Map(), humorChecksInFlight: new Set(), scoldChecksInFlight: new Set(), lastScoldCheck: new Map() };
  let output = { reply: 'Railen: odpowiedź.', opinion: 'O bieżącym rozmówcy.', containsPersonalData: false,
    isOffensive: false, calledNyxMachine: false, flirtsWithNyx: false,
    apologizesToNyx: false, sympathyPoints: 0, musicTrackId: '', stickerSituation: 'none' };
  let beforeCreate = async () => {};
  const handle = createMessageHandler({ memoryDb: db, state, discord: { user: { id: 'nyx', username: 'Nyx' } },
    personality: { basePrompt: 'CORE', contextModules: [{ id: 'ships', title: 'Statki', content: 'SHIPS' }], humorInfo: '' },
    ...options,
    openai: { responses: { create: async request => { calls.push(request); await beforeCreate();
      return { id: `r${calls.length}`, output: [], output_text: JSON.stringify(output) }; } } },
  });
  let seq = 0;
  function message(content, userId = 'sid', channelId = 'c', name = '🧨-offtop', access = true, reference) {
    const member = { displayName: userId, roles: { cache: new Map(access ? [['access', {}]] : []) } };
    members.set(userId, member);
    return { id: `m${++seq}`, content, createdTimestamp: Date.now(), author: { id: userId, username: userId, bot: false }, member,
      guild: { id: 'g', members: { fetch: async ({ user }) => { if (!members.has(user)) throw new Error('Missing member'); return members.get(user); } } },
      mentions: { has: () => content.includes('<@nyx>') },
      reference: reference ? { messageId: reference } : undefined,
      fetchReference: async () => ({ id: reference, author: { id: 'nyx' } }),
      channel: { id: channelId, name, sendTyping: async () => {}, send: async options => { replies.push(options); return { id: `b${++seq}` }; } },
      reply: async options => { replies.push(options); return { id: `b${++seq}` }; }, react: async () => {},
    };
  }
  return { db, calls, replies, state, members, handle, message,
    setOutput: value => { output = { ...output, ...value }; }, setBeforeCreate: value => { beforeCreate = value; } };
}

test('Spontaniczny war w zwykłej rozmowie AI Access: jedna wysyłka, brak modelu i punktów', async () => {
  const stickers = [];
  const { SPONTANEOUS_STICKERS } = require('../modules/config');
  const x = setup({ random: () => 0, config: { ...SPONTANEOUS_STICKERS, WAR_CHANCE: 1 },
    stickerSender: async (message, id, options) => {
      stickers.push(id); await message.reply({ content: options.content, files: [{ name: `sticker-${id}-512.png` }] }); return true;
    } });
  try {
    await x.handle(x.message('Zbieramy ekipę do Star Citizen.', 'sid'));
    await x.handle(x.message('Kto leci na bunkry?', 'no-access', 'c', '🧨-offtop', false));
    assert.equal(stickers.length, 0);
    await x.handle(x.message('Kto leci na bunkry?', 'last'));
    assert.deepEqual(stickers, ['war']);
    assert.equal(x.calls.length, 0);
    assert.equal(x.replies.length, 1);
    assert.equal(getRelationship(x.db, 'last').sympathy, 3);
    assert(getChannelHistory(x.db, 'g', 'c').some(row => row.role === 'nyx' && row.ownerId === 'last'));
    assert(!getChannelHistory(x.db, 'g', 'c').some(row => row.ownerId === 'no-access'));
  } finally { x.db.close(); }
});

test('Pełna rozmowa: sprostowanie innego autora widzi Railena, nie temat z innego kanału', async () => {
  const x = setup();
  try {
    await x.handle(x.message('<@nyx> Co z Constellation?', 'last', 'other'));
    await x.handle(x.message('<@nyx> Co z Railenem?', 'sid'));
    const repliedId = getChannelHistory(x.db, 'g', 'c').find(row => row.role === 'nyx').id;
    await x.handle(x.message('To stare źródło. Znajdź aktualne dane tego statku.', 'last', 'c', '🧨-offtop', true, repliedId));
    const call = x.calls.at(-1);
    assert.match(call.instructions, /Railenem/);
    assert.match(call.instructions, /"authorId":"sid"/);
    assert.doesNotMatch(call.instructions, /Constellation/);
    assert.match(call.instructions, /SHIPS/);
    assert.equal(call.previous_response_id, undefined);
    const input = JSON.parse(call.input);
    assert.equal(input.currentAuthorId, 'last'); assert.equal(input.replyTo, repliedId);
    assert.equal(getRelationship(x.db, 'sid').sympathy, 3);
  } finally { x.db.close(); }
});

test('Pasywna pamięć tylko AI Access, brak wywołań bez zaczepienia, inne kanały i slash text poza modelem', async () => {
  const x = setup();
  try {
    await x.handle(x.message('Zwykła rozmowa o Railenie.'));
    assert.equal(x.calls.length, 0); assert.equal(getChannelHistory(x.db, 'g', 'c').length, 1);
    await x.handle(x.message('<@nyx> Sekret bez roli', 'no-access', 'c', '🧨-offtop', false));
    await x.handle(x.message('<@nyx> Temat raportu', 'sid', 'updates', '💾-aktualizacje'));
    assert.equal(x.calls.length, 0); assert.equal(getChannelHistory(x.db, 'g', 'updates').length, 0);
    await x.handle(x.message('/nyx rep', 'sid'));
    assert.equal(x.calls.length, 0); assert.match(x.replies.at(-1).content, /menu poleceń/);
    assert.equal(getChannelHistory(x.db, 'g', 'c').length, 1);
  } finally { x.db.close(); }
});

test('Odebrana rola usuwa teksty i powiązane odpowiedzi przed kolejnym API', async () => {
  const x = setup();
  try {
    await x.handle(x.message('<@nyx> Railen', 'sid'));
    x.members.get('sid').roles.cache.clear();
    await x.handle(x.message('<@nyx> Cześć', 'last'));
    assert.doesNotMatch(x.calls.at(-1).instructions, /Railen/);
    assert(!getChannelHistory(x.db, 'g', 'c').some(row => row.ownerId === 'sid'));
  } finally { x.db.close(); }
});

test('Wynik filtra modelu usuwa wpis wejściowy i blokuje zapis odpowiedzi', async () => {
  const x = setup();
  try {
    x.setOutput({ containsPersonalData: true });
    await x.handle(x.message('<@nyx> Przykład danych', 'sid'));
    assert.equal(x.replies.length, 1);
    assert.equal(getChannelHistory(x.db, 'g', 'c').length, 0);
  } finally { x.db.close(); }
});

test('Purge podczas API dla innej osoby unieważnia wspólny kontekst i blokuje późny zapis', async () => {
  const x = setup();
  let release, reached;
  const waiting = new Promise(r => { release = r; }), started = new Promise(r => { reached = r; });
  try {
    await x.handle(x.message('Pasywna wypowiedź Sida', 'sid'));
    x.setBeforeCreate(async () => { reached(); await waiting; });
    const pending = x.handle(x.message('<@nyx> Sprostuj wypowiedź kolegi', 'last'));
    await started;
    deleteChannelExchanges(x.db, { guildId: 'g', channelId: 'c', userId: 'sid' });
    forgetChannelConversation(x.state, 'g', 'c');
    release(); await pending;
    assert.equal(x.replies.length, 0);
    assert(!getChannelHistory(x.db, 'g', 'c').some(row => row.ownerId === 'sid'));
    assert(!getChannelHistory(x.db, 'g', 'c').some(row => row.role === 'nyx'));
    assert.equal(x.state.conversations.size, 0);
  } finally { release(); x.db.close(); }
});

test('Globalny purge blokuje równoległe odpowiedzi innych osób na wielu kanałach', async () => {
  const x = setup();
  let release, reached, count = 0;
  const waiting = new Promise(r => { release = r; }), started = new Promise(r => { reached = r; });
  try {
    await x.handle(x.message('Pasywna wypowiedź Sida', 'sid', 'c'));
    await x.handle(x.message('Inna wypowiedź Sida', 'sid', 'other'));
    x.setBeforeCreate(async () => { if (++count === 2) reached(); await waiting; });
    const pending = [x.handle(x.message('<@nyx> Sprostuj kolegę', 'last', 'c')),
      x.handle(x.message('<@nyx> Co z jego wypowiedzią?', 'last', 'other'))];
    await started;
    deleteAllUserExchanges(x.db, 'sid'); forgetAllChannelConversations(x.state, 'sid');
    release(); await Promise.all(pending);
    assert.equal(x.replies.length, 0);
    assert.equal(x.state.conversations.size, 0);
    for (const channel of ['c', 'other']) {
      const history = getChannelHistory(x.db, 'g', channel);
      assert(!history.some(row => row.ownerId === 'sid' || row.role === 'nyx'));
      assert(history.some(row => row.ownerId === 'last'));
    }
  } finally { release(); x.db.close(); }
});

test('Nieudana weryfikacja roli pomija kontekst bez kasowania danych; bieżące pytanie działa', async () => {
  const x = setup();
  try {
    await x.handle(x.message('Wypowiedź do zachowania', 'sid'));
    x.members.delete('sid');
    await x.handle(x.message('<@nyx> Cześć', 'last'));
    assert.doesNotMatch(x.calls.at(-1).instructions, /Wypowiedź do zachowania/);
    assert(getChannelHistory(x.db, 'g', 'c').some(row => row.ownerId === 'sid'));
  } finally { x.db.close(); }
});

test('Znacznik ofensywności zapisuje się także przy nowej pamięci kanału', async () => {
  const x = setup();
  try {
    await x.handle(x.message('Neutralny wpis', 'sid'));
    x.db.prepare("UPDATE users SET sympathy=-7 WHERE user_id='sid'").run();
    x.setOutput({ isOffensive: true, sympathyPoints: -2 });
    await x.handle(x.message('<@nyx> Obraźliwa wypowiedź', 'sid'));
    const rows = getChannelHistory(x.db, 'g', 'c');
    assert.equal(rows.filter(row => row.isOffensive).length, 2);
    assert.equal(getRelationship(x.db, 'sid').sympathy, -9);
    await x.handle(x.message('<@nyx> Przepraszam', 'sid'));
    assert(!getChannelHistory(x.db, 'g', 'c').some(row => row.isOffensive));
  } finally { x.db.close(); }
});
