const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openMemory } = require('../modules/memory');
const { createStickerSender, FILES } = require('../modules/stickers');
const { createSpontaneousHandler, isGamePlan } = require('../modules/spontaneous');
const { SPONTANEOUS_STICKERS } = require('../modules/config');
const createHumorHandler = require('../modules/humor');
process.env.AI_ACCESS_ROLE_ID = 'access';
const HOUR = 3600000, START = Date.UTC(2026, 9, 6, 8);

function fixture(t, options = {}) {
  const db = openMemory({ file: ':memory:' }); t.after(() => db.close());
  let clock = START;
  const sent = [], channels = new Map();
  for (const [id, name] of [['lobby', '💬-lobby'], ['bar', '🍻-kantyna'], ['off', '🧨-offtop']]) {
    channels.set(id, { id, name, isTextBased: () => true, send: async value => { sent.push(value); } });
  }
  const guild = { id: 'g', channels: { cache: channels } };
  const discord = { user: { id: 'nyx' }, guilds: { cache: new Map([['g', guild]]) } };
  const state = { lastSpontaneousReply: new Map() };
  const sender = createStickerSender(db, { now: () => clock, random: () => 0, exists: () => true });
  const context = { discord, memoryDb: db, state, stickerSender: sender, now: () => clock,
    random: () => 0, config: { ...SPONTANEOUS_STICKERS, WAR_CHANCE: 1, BORED_CHANCE: 1 }, ...options };
  const scenes = createSpontaneousHandler(context);
  function message(content = 'Wiadomość załogi', { access = true, channelId = 'lobby', bot = false, userId = 'u' } = {}) {
    return { id: 'm', content, guild, channel: channels.get(channelId),
      author: { id: userId, bot }, member: { roles: { cache: new Map(access ? [['access', {}]] : []) } },
      nyxContext: { isCurrent: () => true, loadHistory: async () => [{ role: 'user', date: new Date(clock - 1000).toISOString(), content: 'Zbieramy ekipę do Star Citizen.' }] },
      reply: async value => { sent.push(value); } };
  }
  return { db, context, scenes, sent, state, message, setClock: value => { clock = value; } };
}

test('War rozpoznaje plan w grze, nie prawdziwy konflikt, negację ani samą wzmiankę', () => {
  assert(isGamePlan('Kto leci na bunkry?'));
  assert(isGamePlan("Let's group up for Jumptown!"));
  assert(isGamePlan('To lecimy?', ['Gramy dzisiaj w Star Citizen.']));
  assert(!isGamePlan('Wojna w Star Citizen jest ciekawa.'));
  assert(!isGamePlan('Nie lecimy na bunkry.'));
  assert(!isGamePlan('Idziemy na wojnę w Ukrainie.', ['Star Citizen.']));
  assert(!isGamePlan('Idziemy do sklepu.'));
});

test('War wymaga AI Access i świeżej wymiany; nie nalicza reputacji ani nie wywołuje API', async t => {
  const x = fixture(t);
  assert.equal(await x.scenes.maybeWar(x.message('Kto leci na bunkry?', { access: false })), false);
  const alone = x.message('Kto leci na bunkry?'); alone.nyxContext.loadHistory = async () => [];
  assert.equal(await x.scenes.maybeWar(alone), false);
  const old = x.message('Kto leci na bunkry?'); old.nyxContext.loadHistory = async () => [{ role: 'user', date: new Date(START - HOUR).toISOString(), content: 'Star Citizen' }];
  assert.equal(await x.scenes.maybeWar(old), false);
  assert.equal(await x.scenes.maybeWar(x.message('Kto leci na bunkry?')), true);
  assert.match(x.sent[0].content, /gotowa/);
  assert.match(x.sent[0].files[0].name, /war/);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM sympathy_events').get().n, 0);
});

test('War sprawdza ponownie rolę i wersję kontekstu po pobraniu historii; losuje przed odczytem', async t => {
  const x = fixture(t);
  const message = x.message('Kto leci na bunkry?');
  message.nyxContext.loadHistory = async () => { message.member.roles.cache.clear(); return [{ role: 'user', date: new Date(START).toISOString(), content: 'Star Citizen' }]; };
  assert.equal(await x.scenes.maybeWar(message), false);
  const stale = x.message('Kto leci na bunkry?');
  stale.nyxContext.loadHistory = async () => { stale.nyxContext.isCurrent = () => false; return [{ role: 'user', date: new Date(START).toISOString(), content: 'Star Citizen' }]; };
  assert.equal(await x.scenes.maybeWar(stale), false);
  const rare = createSpontaneousHandler({ ...x.context, random: () => 0.99, config: SPONTANEOUS_STICKERS });
  const rareMessage = x.message('Kto leci na bunkry?');
  rareMessage.nyxContext.loadHistory = async () => assert.fail('Losowanie powinno odrzucić przed odczytem');
  assert.equal(await rare.maybeWar(rareMessage), false);
  assert.equal(x.sent.length, 0);
});

test('Bored: sześć godzin ciszy Nyx, aktywna rozmowa załogi nie zeruje czasu, wiadomość z obrazkiem', async t => {
  const x = fixture(t);
  await x.scenes.tick(); assert.equal(x.sent.length, 0);
  x.scenes.activity(x.message());
  await x.scenes.tick(); assert.equal(x.sent.length, 0);
  x.setClock(START + 6 * HOUR - 1);
  x.scenes.activity(x.message('Ludzie nadal rozmawiają')); // To nie zaczepienie Nyx.
  await x.scenes.tick(); assert.equal(x.sent.length, 0);
  x.setClock(START + 6 * HOUR);
  await x.scenes.tick(); assert.equal(x.sent.length, 1);
  assert.match(x.sent[0].files[0].name, /bored/);
  assert(x.sent[0].content.length > 0);
  assert.deepEqual(x.sent[0].allowedMentions.parse, []);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM channel_messages').get().n, 0);
  await x.scenes.tick(); assert.equal(x.sent.length, 1);
  x.setClock(START + 12 * HOUR); await x.scenes.tick(); assert.equal(x.sent.length, 1); // 24h typu
});

test('Bored pomija osoby bez dostępu, niedozwolone kanały i dawno opustoszałe serwery', async t => {
  const x = fixture(t);
  x.scenes.activity(x.message('Bez zgody', { access: false }));
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM spontaneous_activity').get().n, 0);
  x.scenes.activity(x.message('Offtop', { channelId: 'off' }));
  x.setClock(START + 6 * HOUR); await x.scenes.tick(); assert.equal(x.sent.length, 0);
  x.scenes.activity(x.message('Lobby'));
  x.setClock(START + 31 * HOUR); await x.scenes.tick(); assert.equal(x.sent.length, 0);
});

test('Zaczepienie, komenda lub wypowiedź Nyx resetują ciszę; stan przetrwa nowy handler', async t => {
  const x = fixture(t);
  x.scenes.activity(x.message());
  x.setClock(START + 5 * HOUR);
  x.scenes.activity(x.message('Nyx?', { channelId: 'off' }), true);
  x.setClock(START + 6 * HOUR); await x.scenes.tick(); assert.equal(x.sent.length, 0);
  x.scenes.contact('g', 'off');
  x.setClock(START + 11 * HOUR); await x.scenes.tick(); assert.equal(x.sent.length, 0);
  x.scenes.activity(x.message('Odpowiedź', { userId: 'nyx', bot: true, channelId: 'off' }));
  const restarted = createSpontaneousHandler(x.context);
  x.setClock(START + 16 * HOUR); await restarted.tick(); assert.equal(x.sent.length, 0);
  x.setClock(START + 17 * HOUR); await restarted.tick(); assert.equal(x.sent.length, 1);
});

test('War i bored dzielą limit z innymi stickerami; błąd wysyłki zwraca miejsce', async t => {
  const x = fixture(t);
  x.scenes.activity(x.message());
  await x.context.stickerSender(x.message(), 'focus', { guaranteed: true });
  assert.equal(await x.scenes.maybeWar(x.message('Kto leci na bunkry?')), true);
  x.setClock(START + 6 * HOUR); await x.scenes.tick(); assert.equal(x.sent.length, 2);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM sticker_deliveries').get().n, 2);
  assert(FILES.war && FILES.bored);
  x.setClock(START + 24 * HOUR);
  const failed = x.message(); failed.reply = async () => { throw new Error('Discord failed'); };
  assert.equal(await x.context.stickerSender(failed, 'bored', { guaranteed: true }), false);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM sticker_deliveries').get().n, 2);
  assert.equal(await x.context.stickerSender(x.message(), 'bored', { guaranteed: true }), true);
});

test('TWSS nie wywołuje API bez roli, filtruje kontekst i ponownie sprawdza rolę przed wysłaniem', async t => {
  const x = fixture(t);
  const calls = [];
  let beforeResponse = () => {};
  const handler = createHumorHandler({ personality: { humorInfo: '' },
    state: { lastSpontaneousReply: new Map(), humorChecksInFlight: new Set() },
    openai: { responses: { create: async request => { calls.push(request); beforeResponse(); return { output_text: '{"should_joke":true}' }; } } } });
  await handler(x.message('Duży i ciasny', { access: false })); assert.equal(calls.length, 0);
  const message = x.message('Duży i ciasny'); message.createdTimestamp = Date.now();
  const denied = x.message('SEKRET BEZ AI ACCESS', { access: false }); denied.createdTimestamp = message.createdTimestamp - 500;
  message.channel.messages = { fetch: async () => new Map([['denied', denied]]) };
  beforeResponse = () => message.member.roles.cache.clear();
  await handler(message);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].input, /SEKRET/);
  assert.equal(x.sent.length, 0);
  message.member.roles.cache.set('access', {}); beforeResponse = () => {};
  await handler(message); assert.equal(x.sent.length, 1);
});
