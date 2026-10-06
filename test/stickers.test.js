const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createStickerSender, selectSticker, localDay } = require('../modules/stickers');
const files = { focus: '/fake/focus.png', wink: '/fake/wink.png', angry: '/fake/angry.png', salute: '/fake/salute.png' };

test('Stickery: progi, przejścia i brak obchodzenia limitu dodatnich', () => {
  const base = { before: 15, after: 15, applied: true, points: 2, content: 'x'.repeat(120), situation: 'thumbup' };
  assert.equal(selectSticker(base), 'thumbup');
  assert.equal(selectSticker({ ...base, before: 14 }), null);
  assert.equal(selectSticker({ ...base, content: 'krótko' }), null);
  assert.equal(selectSticker({ ...base, suppressed: true }), null);
  assert.equal(selectSticker({ ...base, before: 19, after: 20 }), 'wink');
  assert.equal(selectSticker({ ...base, before: 20, after: 20, situation: 'none' }), null);
  assert.equal(selectSticker({ ...base, before: -19, after: -20 }), 'angry');
  assert.equal(selectSticker({ ...base, situation: 'salute' }), 'salute');
  assert.equal(selectSticker({ ...base, before: 3, situation: 'salute' }), null);
  assert.equal(selectSticker({ ...base, before: -7, situation: 'sulk' }), 'sulk');
});

test('Dwie wysyłki globalnie, rezerwacje równoległe i restart nie odnawia limitu dnia', async () => {
  const db = new DatabaseSync(':memory:');
  let release;
  const wait = new Promise(r => { release = r; });
  const sent = [];
  const message = { reply: async options => { sent.push(options); await wait; } };
  const options = { files, exists: () => true, random: () => 0, now: () => Date.UTC(2026, 9, 5, 10) };
  try {
    const send = createStickerSender(db, options);
    const a = send(message, 'focus'), b = send(message, 'wink');
    assert.equal(await send(message, 'angry'), false);
    const restarted = createStickerSender(db, options);
    assert.equal(await restarted(message, 'salute'), false);
    release(); assert.equal(await a, true); assert.equal(await b, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].allowedMentions.repliedUser, false);
  } finally { db.close(); }
});

test('24h cooldown, jedna grafika na wiadomość, losowanie i polska północ', async () => {
  const db = new DatabaseSync(':memory:');
  let clock = Date.UTC(2026, 9, 5, 21, 59);
  const message = { reply: async () => {} }, turn = { sent: false };
  try {
    const send = createStickerSender(db, { files, exists: () => true, random: () => 0, now: () => clock });
    assert.equal(await send(message, 'focus', { turn }), true);
    assert.equal(await send(message, 'wink', { turn }), false);
    clock += 2 * 60 * 1000;
    assert.notEqual(localDay(clock), localDay(clock - 2 * 60 * 1000));
    assert.equal(await send(message, 'focus'), false);
    clock += 24 * 60 * 60 * 1000;
    assert.equal(await send(message, 'focus'), true);
    const rare = createStickerSender(db, { files, exists: () => true, random: () => 0.99, now: () => clock });
    assert.equal(await rare(message, 'salute'), false);
    assert.equal(await rare(message, 'wink', { guaranteed: true }), true);
  } finally { db.close(); }
});

test('Brak pliku i błąd Discorda nie zużywają limitu ani cooldownu', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const send = createStickerSender(db, { files, exists: () => true, random: () => 0 });
    assert.equal(await send({ reply: async () => { throw new Error('Discord failed'); } }, 'focus'), false);
    assert.equal(await send({ reply: async () => {} }, 'focus'), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sticker_deliveries').get().n, 1);
    const missing = createStickerSender(db, { files, exists: () => false, random: () => 0 });
    assert.equal(await missing({ reply: async () => assert.fail() }, 'wink'), false);
  } finally { db.close(); }
});

test('Focus jest wywołany przed researcherem i tylko raz na całą odpowiedź', async () => {
  const { createResearchedResponse } = require('../modules/web-research');
  const { researchResult } = require('../test-support/research');
  const order = [];
  const result = await createResearchedResponse({ responses: { create: async request => {
    if (request.tool_choice === 'required') { order.push('research'); return researchResult(); }
    if (request.previous_response_id) return { id: 'done', output: [], output_text: 'Odpowiedź' };
    return { id: 'start', output: [{ type: 'function_call', name: 'research_web', call_id: 'call', arguments: '{"query":"Star Citizen"}' }] };
  } } }, { model: 'test', input: 'Pytanie' }, { beforeResearch: async () => order.push('focus') });
  assert.deepEqual(order, ['focus', 'research']);
  assert.equal(result.researchCalls, 1);
});
