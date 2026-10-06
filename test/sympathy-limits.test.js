const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openMemory, applySympathyEvent, undoReactionAward, getRelationship, acceptApology } = require('../modules/memory');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const START = 1_800_000_000_000;

function fixture(t) {
  const db = openMemory({ file: ':memory:' });
  t.after(() => db.close());
  let id = 0;
  return { db, event: (options = {}) => applySympathyEvent(db, {
    eventId: `message:g:${++id}`, userId: 'tester', displayName: 'Tester',
    points: 0, messageContent: `Konkretna wiadomość o statkach numer ${id}`,
    now: START, ...options,
  }) };
}

test('Spam podziękowań, cooldown i powtórki po restarcie nie zarabiają', (t) => {
  const { db, event } = fixture(t);
  assert.equal(event({ points: 1, messageContent: 'Dziękuję za wyszukiwanie!' }).delta, 1);
  assert.equal(event({ points: 2, now: START + MINUTE }).delta, 0);
  const repeated = event({ points: 1, messageContent: 'DZIEKUJE, za wyszukiwanie!!', now: START + 16 * MINUTE });
  assert.equal(repeated.delta, 0);
  assert.equal(repeated.repeatedMessage, true);
  assert.equal(event({ points: 2, now: START + 17 * MINUTE }).delta, 2);
  assert.equal(getRelationship(db, 'tester').sympathy, 6);
  // SQL, a nie RAM: nowy handler nadal zobaczy historię i cooldown.
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message_fingerprints').get().count, 3);
});

test('Wszystkie dodatnie źródła dzielą budżet +3/4h; upływ okna go odnawia', (t) => {
  const { event } = fixture(t);
  assert.equal(event({ points: 2 }).delta, 2);
  assert.equal(event({ eventId: 'reaction:nyx:tester', points: 1, reactionEmoji: '❤️', now: START + MINUTE }).delta, 1);
  assert.equal(event({ points: 3, now: START + 20 * MINUTE }).delta, 0);
  assert.equal(event({ points: 3, now: START + 4 * HOUR + 2 * MINUTE }).delta, 3);
});

test('Lajki: pierwsza reakcja per wiadomość, 15 minut, cofnięcie bez odzyskania budżetu', (t) => {
  const { db, event } = fixture(t);
  const first = { eventId: 'reaction:one:tester', points: 1, reactionEmoji: '❤️' };
  assert.equal(event(first).delta, 1);
  for (let i = 2; i <= 20; i++) {
    assert.equal(event({ eventId: `reaction:${i}:tester`, points: 1, reactionEmoji: '👍', now: START + i }).delta, 0);
  }
  assert.equal(undoReactionAward(db, { eventId: first.eventId, userId: 'tester', emoji: '❤️' }).delta, -1);
  assert.equal(event({ ...first, now: START + 16 * MINUTE }).applied, false);
  assert.equal(undoReactionAward(db, { eventId: first.eventId, userId: 'tester', emoji: '❤️' }).undone, false);
  assert.equal(event({ eventId: 'reaction:new:tester', points: 1, reactionEmoji: '👍', now: START + 16 * MINUTE }).delta, 1);
});

test('Bonus rozmowy wymaga różnych, nieobraźliwych wiadomości rozłożonych w czasie', (t) => {
  const { event } = fixture(t);
  for (let i = 0; i < 10; i++) assert.equal(event({ countForStreak: true, now: START + i }).streakDelta, 0);
  let result;
  for (let i = 1; i <= 9; i++) result = event({ countForStreak: true, now: START + i * MINUTE });
  assert.equal(result.streakDelta, 1);
  for (let i = 10; i < 20; i++) assert.equal(event({ countForStreak: true, now: START + i * MINUTE }).streakDelta, 0);
});

test('Powtarzanie jednej treści nie buduje bonusu; obelga zeruje ciąg', (t) => {
  const { db, event } = fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal(event({ messageContent: 'Co lubisz w Argo?', countForStreak: true, now: START + i * MINUTE }).streakDelta, 0);
  }
  assert.equal(db.prepare('SELECT clean_count FROM conversation_streaks').get().clean_count, 1);
  event({ isOffensive: true, points: -1, countForStreak: true, now: START + 11 * MINUTE });
  assert.equal(db.prepare('SELECT clean_count FROM conversation_streaks').get().clean_count, 0);
});

test('Ujemne punkty nie mają cooldownu, probation mnoży kary, special chroni -9', (t) => {
  const { db, event } = fixture(t);
  event();
  db.prepare('UPDATE users SET sympathy = -7, special = 1, probation_until = ?').run(START + HOUR);
  assert.equal(event({ points: -2 }).delta, -2);
  assert.equal(event({ points: -3 }).sympathy, -9);
  db.prepare('UPDATE users SET sympathy = -10, special = 0').run();
  assert.equal(event({ points: 2, now: START + 16 * MINUTE }).delta, 0);
});

test('Przeprosiny zachowują dodatnią reputację i nie kasują limitów nagród', (t) => {
  const { db, event } = fixture(t);
  event({ points: 3 });
  assert.equal(acceptApology(db, 'tester', START + MINUTE).accepted, false);
  assert.equal(getRelationship(db, 'tester').sympathy, 6);
  db.prepare('UPDATE users SET sympathy = -20, offended = 1').run();
  assert.equal(acceptApology(db, 'tester', START + 2 * MINUTE).sympathy, 0);
  assert.equal(event({ points: 2, now: START + 16 * MINUTE }).delta, 0);
});

test('Limity i wykrywanie powtórek przetrwają zamknięcie i otwarcie SQLite', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'test.sqlite');
  let db = openMemory({ file });
  const options = { eventId: 'message:g:1', userId: 'u', displayName: 'Tester', points: 1,
    messageContent: 'Dziękuję za dobrą odpowiedź!', now: START };
  applySympathyEvent(db, options);
  db.close();
  db = openMemory({ file });
  try {
    const result = applySympathyEvent(db, { ...options, eventId: 'message:g:2', now: START + 16 * MINUTE });
    assert.equal(result.repeatedMessage, true);
    assert.equal(result.delta, 0);
    assert.equal(getRelationship(db, 'u').sympathy, 4);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
