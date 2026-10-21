const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openMemory, getRelationship } = require('../modules/memory');
const { saveChannelMessage, getChannelHistory, deleteChannelExchanges, isConversationChannel } = require('../modules/channel-memory');
const { channelVersion, forgetChannelConversation } = require('../modules/memory-control');
const { CHAT_MEMORY } = require('../modules/config');

function save(db, content, { channelId = 'c', guildId = 'g', userId = 'a', kind = 'user', messageId = content, exchangeId = messageId, now = Date.now() } = {}) {
  return saveChannelMessage(db, { guildId, channelId, userId, authorId: kind === 'nyx' ? 'nyx' : userId,
    displayName: kind === 'nyx' ? 'Nyx' : userId, kind, messageId, exchangeId, content, now });
}

test('Kontekst wspólny dla autorów, izolowany per kanał/serwer, zachowuje ID i chronologię', () => {
  const db = openMemory({ file: ':memory:' });
  try {
    save(db, 'Pytanie o Railena', { userId: 'sid' });
    save(db, 'Odpowiedź dla Sida', { userId: 'sid', kind: 'nyx', exchangeId: 'Pytanie o Railena' });
    save(db, 'Sprostuj to', { userId: 'last' });
    save(db, 'Temat z innego kanału', { channelId: 'other' });
    save(db, 'Temat z innego serwera', { guildId: 'other' });
    const rows = getChannelHistory(db, 'g', 'c');
    assert.deepEqual(rows.map(row => row.authorId), ['sid', 'nyx', 'last']);
    assert.deepEqual(rows.map(row => row.content), ['Pytanie o Railena', 'Odpowiedź dla Sida', 'Sprostuj to']);
    assert.equal(rows[1].exchangeId, rows[0].id);
    assert.equal(getChannelHistory(db, 'g', 'c', { excludeMessageId: 'Sprostuj to' }).length, 2);
  } finally { db.close(); }
});

test('Limit 20, budżet 12000 znaków z metadanymi, TTL 12h i deduplikacja', () => {
  const db = openMemory({ file: ':memory:' });
  try {
    for (let i = 0; i < 25; i++) save(db, `Wiadomość ${i}`);
    assert.equal(getChannelHistory(db, 'g', 'c').length, 20);
    save(db, 'Wiadomość 24'); assert.equal(getChannelHistory(db, 'g', 'c').length, 20);
    for (let i = 0; i < 20; i++) save(db, 'x'.repeat(2000), { messageId: `long:${i}` });
    assert(JSON.stringify(getChannelHistory(db, 'g', 'c')).length <= CHAT_MEMORY.MAX_CONTEXT_CHARS);
    assert.equal(save(db, 'y'.repeat(3001)), false);
    const now = Date.now();
    save(db, 'Przeterminowana', { now: now - 13 * 60 * 60 * 1000 });
    assert(!getChannelHistory(db, 'g', 'c').some(row => row.content === 'Przeterminowana'));
    assert.equal(getChannelHistory(db, 'g', 'c', { now: now + 12 * 60 * 60 * 1000 + 1 }).length, 0);
  } finally { db.close(); }
});

test('Prywatność: lokalny filtr, dane z modelu oraz za duże teksty nie trafiają do historii', () => {
  const db = openMemory({ file: ':memory:' });
  try {
    for (const content of ['test@example.com', 'Mam na imię Jan', 'Mój numer telefonu 123 456 789']) assert.equal(save(db, content), false);
    assert.equal(saveChannelMessage(db, { guildId: 'g', channelId: 'c', userId: 'a', messageId: 'name', displayName: 'Jan', content: 'Jan', containsPersonalData: true }), false);
    assert.equal(getChannelHistory(db, 'g', 'c').length, 0);
  } finally { db.close(); }
});

test('Clean/purge usuwa tylko autora w danym kanale wraz z odpowiedziami, zachowuje relacje i innych', () => {
  const db = openMemory({ file: ':memory:' });
  try {
    for (let i = 0; i < 3; i++) {
      save(db, `Pytanie ${i}`, { messageId: `u${i}` });
      save(db, `Odpowiedź ${i}`, { messageId: `b${i}`, kind: 'nyx', exchangeId: `u${i}` });
    }
    save(db, 'Inna osoba', { userId: 'b' }); save(db, 'Inny kanał', { channelId: 'other' });
    db.prepare("UPDATE users SET sympathy=17, opinion='Blisko', special=1 WHERE user_id='a'").run();
    assert.equal(deleteChannelExchanges(db, { guildId: 'g', channelId: 'c', userId: 'a', count: 2 }), 2);
    assert.deepEqual(getChannelHistory(db, 'g', 'c').map(r => r.content), ['Pytanie 0', 'Odpowiedź 0', 'Inna osoba']);
    assert.equal(deleteChannelExchanges(db, { guildId: 'g', channelId: 'c', userId: 'a' }), 1);
    assert.deepEqual(getChannelHistory(db, 'g', 'c').map(r => r.content), ['Inna osoba']);
    assert.equal(getChannelHistory(db, 'g', 'other').length, 1);
    assert.equal(getRelationship(db, 'a').sympathy, 17);
    assert.equal(getRelationship(db, 'a').special, true);
    assert.equal(getRelationship(db, 'a').opinion, 'Blisko');
  } finally { db.close(); }
});

test('Purge unieważnia cały kanał, nie inne kanały i serwery', () => {
  const state = { conversations: new Map([['g:c:a', {}], ['g:c:b', {}], ['g:other:a', {}], ['other:c:a', {}]]) };
  const version = channelVersion(state, 'g', 'c'); forgetChannelConversation(state, 'g', 'c');
  assert.notEqual(channelVersion(state, 'g', 'c'), version);
  assert.deepEqual([...state.conversations.keys()], ['g:other:a', 'other:c:a']);
});

test('Lista kanałów obsługuje nazwy/ID i nie dopuszcza wątków ani kanałów raportu', () => {
  for (const name of CHAT_MEMORY.CHANNELS) assert(isConversationChannel({ name, id: 'id' }));
  assert(isConversationChannel({ name: 'inna nazwa', id: '123' }, ['123']));
  assert(!isConversationChannel({ name: '💾-aktualizacje', id: 'updates' }));
  assert(!isConversationChannel({ name: 'wątek', id: 'thread', parentId: 'lobby' }));
});

test('Migracja zachowuje stary bank i punkty, ale nie przypisuje starych wiadomości do kanałów', () => {
  const db = openMemory({ file: ':memory:' });
  try {
    db.prepare("INSERT INTO users (user_id, display_name, sympathy) VALUES ('a','Tester',16)").run();
    db.prepare("INSERT INTO message_bank (user_id, created_at, content, response) VALUES ('a', ?, 'Starszy temat', 'Odpowiedź')").run(Date.now());
    assert.equal(getChannelHistory(db, 'g', 'c').length, 0);
    assert.equal(getRelationship(db, 'a').sympathy, 16);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_bank').get().n, 1);
  } finally { db.close(); }
});

test('Kontekst kanału przetrwa zamknięcie i ponowne otwarcie bazy', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-channel-test-'));
  const file = path.join(folder, 'memory.sqlite');
  let db;
  try {
    db = openMemory({ file }); save(db, 'Rozmowa przed restartem'); db.close();
    db = openMemory({ file });
    assert.equal(getChannelHistory(db, 'g', 'c')[0].content, 'Rozmowa przed restartem');
  } finally { if (db?.isOpen) db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
