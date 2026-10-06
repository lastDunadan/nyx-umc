const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { initFuel, recordFuelUsage, setFuelBalance, getFuel, createMeteredOpenAI } = require('../modules/fuel');

function response(id, input = 1000, output = 100, cached = 500) {
  return { id, model: 'gpt-6-luna', usage: { input_tokens: input, output_tokens: output,
    input_tokens_details: { cached_tokens: cached } }, output: [{ type: 'web_search_call' }] };
}

test('Koszt uwzględnia wejście, cache, wyjście, wyszukiwanie i duplikaty response id', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initFuel(db); setFuelBalance(db, 10);
    recordFuelUsage(db, response('one'), {}, { category: 'message', groupId: 'm' });
    recordFuelUsage(db, response('one'), {}, { category: 'message', groupId: 'm' });
    const fuel = getFuel(db);
    assert.equal(fuel.calls, 1);
    assert(Math.abs(fuel.spent - 0.010105) < 1e-10);
    assert(Math.abs(fuel.balance - 9.989895) < 1e-10);
    setFuelBalance(db, 20);
    assert.equal(getFuel(db).balance, 20);
    recordFuelUsage(db, response('two'), {}, { category: 'background', groupId: 'news' });
    assert(getFuel(db).balance < 20);
    assert.throws(() => setFuelBalance(db, -1));
    assert.throws(() => setFuelBalance(db, NaN));
  } finally { db.close(); }
});

test('Nieznana stawka/usage/tryb/duży kontekst nie udają pełnego szacunku salda', () => {
  for (const result of [{ ...response('a'), model: 'unknown' }, { id: 'b' },
    { ...response('c'), service_tier: 'priority' }, response('d', 200000)]) {
    const db = new DatabaseSync(':memory:');
    try {
      initFuel(db); setFuelBalance(db, 10);
      recordFuelUsage(db, result, { model: 'gpt-6-luna' });
      assert.equal(getFuel(db).unknown, 1);
      assert.equal(getFuel(db).balance, null);
    } finally { db.close(); }
  }
});

test('Wiele etapów research składa się na jedną wymianę; tło nie jest dodatkową odpowiedzią', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    initFuel(db); setFuelBalance(db, 5);
    let id = 0;
    const metered = createMeteredOpenAI({ responses: { create: async () => response(`r${++id}`) } }, db);
    await Promise.all(Array.from({ length: 5 }, (_, i) => metered.withFuelScope(
      { groupId: `m${i}`, category: 'message' }, async () => {
        await metered.responses.create({ model: 'gpt-6-luna' });
        await metered.responses.create({ model: 'gpt-6-luna' });
      }
    )));
    await metered.responses.create({ model: 'gpt-6-luna' });
    const fuel = getFuel(db);
    assert.equal(fuel.calls, 11);
    assert.equal(fuel.samples, 5);
    assert(Math.abs(fuel.average - 0.02021) < 1e-10);
    assert.equal(fuel.replies, Math.floor(fuel.balance / fuel.average));
    assert.equal(metered.fuelRecordingFailed(), false);
  } finally { db.close(); }
});

test('Błąd zapisu kosztu nie zabiera odpowiedzi; błąd API nadal jest propagowany', async () => {
  const db = new DatabaseSync(':memory:');
  const metered = createMeteredOpenAI({ responses: { create: async () => response('ok') } }, db);
  const result = await metered.responses.create({ model: 'gpt-6-luna' });
  assert.equal(result.id, 'ok');
  assert.equal(metered.fuelRecordingFailed(), true);
  db.close();
  const broken = createMeteredOpenAI({ responses: { create: async () => { throw new Error('API'); } } }, db);
  await assert.rejects(broken.responses.create({}), /API/);
});

test('Brak API nie zapisuje grupy, a niezakończone wymiany nie są próbkami prognozy', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    initFuel(db); setFuelBalance(db, 5);
    const metered = createMeteredOpenAI({ responses: { create: async () => response('one') } }, db);
    await metered.withFuelScope({ category: 'message', groupId: 'ignored' }, async () => {});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fuel_groups').get().n, 0);
    recordFuelUsage(db, response('unfinished'), {}, { category: 'message', groupId: 'unfinished' });
    assert.equal(getFuel(db).samples, 0);
    assert.equal(getFuel(db).replies, null);
  } finally { db.close(); }
});

test('Luka w pomiarze jest trwała; nowe saldo ją usuwa dopiero od nowej granicy', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    initFuel(db); setFuelBalance(db, 5);
    db.exec('DROP TABLE fuel_usage');
    const metered = createMeteredOpenAI({ responses: { create: async () => response('gap') } }, db);
    await metered.responses.create({ model: 'gpt-6-luna' });
    assert.equal(db.prepare('SELECT tracking_gap FROM fuel_checkpoint').get().tracking_gap, 1);
    initFuel(db);
    assert.equal(getFuel(db).balance, null);
    setFuelBalance(db, 4);
    assert.equal(getFuel(db).balance, 4);
  } finally { db.close(); }
});
