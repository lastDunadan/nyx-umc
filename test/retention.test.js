const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openMemory, deleteExpired, applySympathyEvent, undoReactionAward,
  getRelationship, getRecentMessageScoreSum } = require('../modules/memory');
const { TECHNICAL_TTL_MS } = require('../modules/retention');
const { initFuel, recordFuelUsage, setFuelBalance, getFuel } = require('../modules/fuel');
const { createStickerSender, localDay } = require('../modules/stickers');
const NOW = Date.now();
function snowflake(time) { return String((BigInt(time) - 1420070400000n) << 22n); }
function fixture(t) {
  const db = openMemory({ file: ':memory:' });
  t.after(() => db.close());
  return db;
}
function event(db, id, now, points = 0, userId = 'u', reactionEmoji = null) {
  return applySympathyEvent(db, { eventId: id, userId, displayName: userId,
    now, points, reactionEmoji, messageContent: `Unikalna konkretna wiadomość ${id}` });
}

test('Retencja 14 dni zachowuje relacje, trzy ostatnie oceny per użytkownik i aktywne limity', t => {
  const db = fixture(t), old = NOW - TECHNICAL_TTL_MS;
  for (const user of ['u', 'v']) {
    for (let i = 0; i < 5; i++) event(db, `message:${user}:${i}`, old - 10 + i, i === 4 ? -1 : 0, user);
  }
  event(db, 'reaction:old:u', old, 1, 'u', '❤️');
  event(db, 'reaction:new:u', NOW - 60_000, 2, 'u', '❤️');
  db.prepare("UPDATE users SET opinion='Zachowaj', special=1 WHERE user_id='u'").run();
  db.prepare('INSERT INTO conversation_streaks (user_id, last_counted_at) VALUES (?, ?)').run('v', old);
  const before = getRelationship(db, 'u'), sum = getRecentMessageScoreSum(db, 'u');
  deleteExpired(db, NOW);
  deleteExpired(db, NOW);
  assert.deepEqual(getRelationship(db, 'u'), before);
  assert.equal(getRecentMessageScoreSum(db, 'u'), sum);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sympathy_events').get().n, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reaction_awards').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_streaks').get().n, 0);
  assert.equal(event(db, 'message:new:u', NOW, 3).delta, 1); // budżet nadal +3
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('Stara reakcja nie zdobywa ponownie punktów po czyszczeniu i nie cofa reputacji', t => {
  const db = fixture(t), created = NOW - TECHNICAL_TTL_MS - 1;
  const id = `reaction:${snowflake(created)}:u`;
  event(db, id, created, 1, 'u', '❤️');
  const before = getRelationship(db, 'u').sympathy;
  deleteExpired(db, NOW);
  assert.equal(event(db, id, NOW, 1, 'u', '❤️').applied, false);
  assert.equal(undoReactionAward(db, { eventId: id, userId: 'u', emoji: '❤️', now: NOW }).undone, false);
  assert.equal(getRelationship(db, 'u').sympathy, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reaction_awards').get().n, 0);
  const recent = `reaction:${snowflake(NOW - 1000)}:u`;
  assert.equal(event(db, recent, NOW, 1, 'u', '❤️').applied, true);
  assert.equal(undoReactionAward(db, { eventId: recent, userId: 'u', emoji: '❤️', now: NOW }).undone, true);
  assert.equal(event(db, `message:g:${snowflake(created)}`, NOW, -1).applied, false);
});

test('Sprzątanie stickerów zachowuje limit bieżącego dnia i krótsze TTL rozmów/powtórek', async t => {
  const db = fixture(t);
  const send = createStickerSender(db, { now: () => NOW, files: { focus: 'fake.png' }, exists: () => true });
  await send({ reply: async () => {} }, 'focus', { guaranteed: true });
  db.prepare('INSERT INTO sticker_deliveries VALUES (?, ?, ?)').run('old', localDay(NOW - TECHNICAL_TTL_MS - 86_400_000), 'focus');
  event(db, 'message:old', NOW - 86_400_001);
  db.prepare('INSERT INTO message_bank (user_id, created_at, content, response) VALUES (?, ?, ?, ?)')
    .run('u', NOW - 43_200_001, 'stare', 'OK');
  deleteExpired(db, NOW);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sticker_deliveries').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_fingerprints').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_bank').get().n, 0);
});

test('Kompakcja kosztów zachowuje saldo, nieznane koszty, reset i monotoniczne ID', t => {
  const db = fixture(t); initFuel(db); setFuelBalance(db, 10);
  const record = id => recordFuelUsage(db, { id, model: 'gpt-6-luna',
    usage: { input_tokens: 1000, output_tokens: 100 }, output: [] }, {}, { groupId: id, category: 'message' });
  record('old'); record('recent');
  db.prepare('UPDATE fuel_usage SET created_at = ? WHERE response_id = ?').run(NOW - TECHNICAL_TTL_MS, 'old');
  const before = getFuel(db);
  deleteExpired(db, NOW); deleteExpired(db, NOW);
  assert.equal(getFuel(db).balance, before.balance);
  assert.equal(getFuel(db).calls, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fuel_usage').get().n, 1);
  recordFuelUsage(db, { id: 'unknown', model: 'unknown' }, {}, { groupId: 'unknown' });
  db.prepare('UPDATE fuel_usage SET created_at = ?').run(NOW - TECHNICAL_TTL_MS);
  deleteExpired(db, NOW);
  assert.equal(getFuel(db).unknown, 1);
  assert.equal(getFuel(db).balance, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fuel_usage').get().n, 0);
  const highWater = db.prepare('SELECT last_usage_id FROM fuel_archive').get().last_usage_id;
  setFuelBalance(db, 20); record('after-reset');
  assert(db.prepare('SELECT id FROM fuel_usage').get().id > highWater);
  assert.equal(getFuel(db).calls, 1);
  assert.equal(getFuel(db).unknown, 0);
  assert(getFuel(db).balance < 20);
  db.exec('BEGIN IMMEDIATE'); deleteExpired(db, NOW); db.exec('ROLLBACK');
});

test('Nie usuwa połowy wymiany researchu i nie odejmuje kosztów sprzed checkpointu', t => {
  const db = fixture(t); initFuel(db);
  const record = (id, groupId) => recordFuelUsage(db, { id, model: 'gpt-6-luna',
    usage: { input_tokens: 1000, output_tokens: 100 }, output: [] }, {}, { groupId });
  record('before', 'before'); setFuelBalance(db, 5);
  record('part1', 'mixed'); record('part2', 'mixed');
  db.prepare("UPDATE fuel_usage SET created_at = ? WHERE response_id != 'part2'").run(NOW - TECHNICAL_TTL_MS);
  const before = getFuel(db).balance;
  deleteExpired(db, NOW);
  assert.equal(getFuel(db).balance, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fuel_usage').get().n, 2);
  assert.equal(db.prepare('SELECT calls FROM fuel_archive').get().calls, 0);
});
