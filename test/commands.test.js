const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openMemory, saveExchange, getRecentExchanges, getRelationship } = require('../modules/memory');
const { COMMAND, createCommandHandler, registerNyxCommands } = require('../modules/commands');
const { deleteUserExchanges, forgetConversation, memoryVersion } = require('../modules/memory-control');
const { initFuel } = require('../modules/fuel');

function setup() {
  const db = openMemory({ file: ':memory:' });
  initFuel(db);
  const state = { conversations: new Map() };
  const handle = createCommandHandler({ memoryDb: db, state, roleId: 'access' });
  const replies = [];
  function interaction(subcommand, userId = 'a', allowed = true) {
    return {
      commandName: 'nyx', isChatInputCommand: () => true, isButton: () => false,
      user: { id: userId, bot: false }, guildId: 'guild',
      guild: { channels: { cache: { find: () => ({ id: 'info' }) } } },
      member: { roles: allowed ? ['access'] : [] },
      options: { getSubcommand: () => subcommand, getInteger: () => 2 },
      reply: async value => { replies.push(value); },
      update: async value => { replies.push(value); },
    };
  }
  function save(userId, content) {
    saveExchange(db, { userId, displayName: 'Tester', content, response: 'OK', containsPersonalData: false });
  }
  return { db, state, handle, replies, interaction, save };
}

test('Definicja /nyx: 6 podkomend, parametr całkowity 1–10', () => {
  assert.equal(COMMAND.options.length, 6);
  assert.deepEqual(COMMAND.options.find(x => x.name === 'clean').options[0], {
    type: 4, name: 'liczba', description: 'Liczba wymian (wiadomość i odpowiedź)',
    required: true, min_value: 1, max_value: 10,
  });
});

test('Rejestracja tworzy tylko /nyx i nie używa set kasującego inne komendy', async () => {
  let created;
  const guild = { name: 'UMC', commands: { create: async value => { created = value; } } };
  await registerNyxCommands({ guilds: { cache: { size: 1, first: () => guild } } });
  assert.equal(created.name, 'nyx');
  await assert.rejects(registerNyxCommands({ guilds: { cache: { size: 2 } } }));
});

test('Clean usuwa najnowsze wymiany tylko autora, zachowuje opinię i punkty', async () => {
  const x = setup();
  try {
    for (const text of ['pierwsza', 'druga', 'trzecia']) x.save('a', text);
    x.save('b', 'inna osoba');
    x.db.prepare("UPDATE users SET sympathy=16, opinion='Miła rozmowa.' WHERE user_id='a'").run();
    x.state.conversations.set('guild:channel:a', {});
    x.state.conversations.set('guild:other:a', {});
    x.state.conversations.set('guild:channel:b', {});
    await x.handle(x.interaction('clean'));
    assert.deepEqual(getRecentExchanges(x.db, 'a').map(r => r.content), ['pierwsza']);
    assert.equal(getRecentExchanges(x.db, 'b').length, 1);
    assert.equal(getRelationship(x.db, 'a').sympathy, 16);
    assert.equal(getRelationship(x.db, 'a').opinion, 'Miła rozmowa.');
    assert.equal(x.state.conversations.size, 1);
    assert.equal(memoryVersion(x.state, 'a'), 1);
    assert.equal(x.replies[0].flags, 64);
    assert.throws(() => deleteUserExchanges(x.db, 'a', 11));
    assert.throws(() => deleteUserExchanges(x.db, 'a', 0));
  } finally { x.db.close(); }
});

test('Purge wymaga potwierdzenia autora; nie daje się powtórzyć ani wykonać za inną osobę', async () => {
  const x = setup();
  try {
    x.save('a', 'testowa wymiana');
    await x.handle(x.interaction('purge'));
    assert.equal(getRecentExchanges(x.db, 'a').length, 1);
    const id = x.replies[0].components[0].components[0].custom_id;
    function button(user) {
      const i = x.interaction('purge', user);
      return { ...i, isChatInputCommand: () => false, isButton: () => true, customId: id };
    }
    await x.handle(button('b'));
    assert.equal(getRecentExchanges(x.db, 'a').length, 1);
    await x.handle(button('a'));
    assert.equal(getRecentExchanges(x.db, 'a').length, 0);
    const version = memoryVersion(x.state, 'a');
    await x.handle(button('a'));
    assert.equal(memoryVersion(x.state, 'a'), version);
  } finally { x.db.close(); }
});

test('Potwierdzenie purge wygasa i można je anulować', async () => {
  const x = setup();
  const original = Date.now;
  try {
    x.save('a', 'testowa wymiana');
    const start = Date.now();
    Date.now = () => start;
    await x.handle(x.interaction('purge'));
    let id = x.replies[0].components[0].components[0].custom_id;
    const click = customId => ({ ...x.interaction('purge'), isChatInputCommand: () => false,
      isButton: () => true, customId });
    Date.now = () => start + 61000;
    await x.handle(click(id));
    assert.equal(getRecentExchanges(x.db, 'a').length, 1);
    await x.handle(x.interaction('purge'));
    id = x.replies.at(-1).components[0].components[1].custom_id;
    await x.handle(click(id));
    assert.equal(getRecentExchanges(x.db, 'a').length, 1);
    assert.match(x.replies.at(-1).content, /anulowane/);
  } finally { Date.now = original; x.db.close(); }
});

test('Help, rep, privacy i fuel są prywatne i nie wywołują modelu', async () => {
  const x = setup();
  try {
    for (const name of ['help', 'rep', 'privacy', 'fuel']) await x.handle(x.interaction(name));
    assert(x.replies.every(r => r.flags === 64 && r.allowedMentions.parse.length === 0));
    assert.match(x.replies[0].content, /<#info>/);
    assert.match(x.replies[1].content, /3 \/ 20/);
    const before = x.replies.length;
    await x.handle({ ...x.interaction('help'), commandName: 'another' });
    assert.equal(x.replies.length, before);
    await x.handle(x.interaction('clean', 'a', false));
    assert.match(x.replies.at(-1).content, /AI Access/);
  } finally { x.db.close(); }
});

test('Wersja pamięci blokuje późny zapis po purge, również bez wcześniejszych rozmów', () => {
  const state = { conversations: new Map() };
  const captured = memoryVersion(state, 'a');
  forgetConversation(state, 'a');
  assert.notEqual(captured, memoryVersion(state, 'a'));
});
