const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

// USD / 1 mln tokenów, standardowy tryb. Źródło: cennik OpenAI, 2026-10-04.
// Duże konteksty i niestandardowe tryby pozostawiamy jako nieoszacowane.
const PRICES = {
  'gpt-6-luna': { input: 0.10, cached: 0.01, output: 0.50, maxInput: 128000 },
};
const WEB_SEARCH_USD = 0.01;

function initFuel(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fuel_checkpoint (
      id INTEGER PRIMARY KEY CHECK (id = 1), balance_usd REAL,
      confirmed_at INTEGER, after_usage_id INTEGER NOT NULL DEFAULT 0,
      tracking_gap INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO fuel_checkpoint (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS fuel_usage (
      id INTEGER PRIMARY KEY, response_id TEXT NOT NULL UNIQUE,
      group_id TEXT NOT NULL, category TEXT NOT NULL,
      created_at INTEGER NOT NULL, model TEXT NOT NULL,
      input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER,
      searches INTEGER NOT NULL, cost_usd REAL
    );
    CREATE INDEX IF NOT EXISTS fuel_usage_group ON fuel_usage(group_id);
    CREATE TABLE IF NOT EXISTS fuel_groups (
      group_id TEXT PRIMARY KEY, completed INTEGER NOT NULL
    );
  `);
  if (!db.prepare('PRAGMA table_info(fuel_checkpoint)').all().some(row => row.name === 'tracking_gap')) {
    db.exec('ALTER TABLE fuel_checkpoint ADD COLUMN tracking_gap INTEGER NOT NULL DEFAULT 0');
  }
}

function setFuelBalance(db, dollars, now = Date.now()) {
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error('Niepoprawne saldo USD.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM fuel_usage').get().id;
    db.prepare(`UPDATE fuel_checkpoint SET balance_usd = ?, confirmed_at = ?,
      after_usage_id = ?, tracking_gap = 0 WHERE id = 1`).run(dollars, now, last);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function recordFuelUsage(db, result, request, scope = {}, prices = PRICES) {
  const model = result.model ?? request.model;
  const input = result.usage?.input_tokens;
  const output = result.usage?.output_tokens;
  const cached = result.usage?.input_tokens_details?.cached_tokens ?? 0;
  const searches = result.output?.filter(item => item.type === 'web_search_call').length ?? 0;
  const price = prices[model];
  const tier = result.service_tier ?? request.service_tier ?? 'default';
  const cacheWrites = result.usage?.input_tokens_details?.cache_creation_tokens ?? 0;
  const valid = price && Number.isInteger(input) && input >= 0 &&
    Number.isInteger(output) && output >= 0 && Number.isInteger(cached) &&
    cached >= 0 && cached <= input && input <= price.maxInput &&
    ['default', 'auto'].includes(tier) && cacheWrites === 0;
  const cost = valid
    ? ((input - cached) * price.input + cached * price.cached + output * price.output) / 1e6 + searches * WEB_SEARCH_USD
    : null;
  db.prepare(`INSERT OR IGNORE INTO fuel_usage
    (response_id, group_id, category, created_at, model, input_tokens,
     cached_tokens, output_tokens, searches, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    result.id ?? randomUUID(), scope.groupId ?? randomUUID(), scope.category ?? 'background',
    Date.now(), model ?? 'unknown', input ?? null, cached, output ?? null, searches, cost
  );
}

function createMeteredOpenAI(client, db) {
  const context = new AsyncLocalStorage();
  let recordingFailed = false;
  return {
    withFuelScope(scope, work) {
      const activeScope = { ...scope, used: false };
      return context.run(activeScope, async () => {
        const value = await work();
        if (!activeScope.used) return value;
        try {
          db.prepare('INSERT OR REPLACE INTO fuel_groups (group_id, completed) VALUES (?, 1)').run(scope.groupId);
        } catch (error) {
          recordingFailed = true;
          try { db.prepare('UPDATE fuel_checkpoint SET tracking_gap = 1 WHERE id = 1').run(); } catch {}
          console.error('[Nyx] Nie udało się zakończyć pomiaru wymiany:', error.message);
        }
        return value;
      });
    },
    fuelRecordingFailed() { return recordingFailed; },
    responses: {
      async create(request) {
        const result = await client.responses.create(request);
        const scope = context.getStore();
        if (scope) scope.used = true;
        try { recordFuelUsage(db, result, request, scope); }
        catch (error) {
          recordingFailed = true;
          try { db.prepare('UPDATE fuel_checkpoint SET tracking_gap = 1 WHERE id = 1').run(); } catch {}
          console.error('[Nyx] Nie udało się zapisać kosztu API:', error.message);
        }
        return result;
      },
    },
  };
}

function getFuel(db) {
  const checkpoint = db.prepare('SELECT * FROM fuel_checkpoint WHERE id = 1').get();
  const usage = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS spent,
    COUNT(*) AS calls, COALESCE(SUM(cost_usd IS NULL), 0) AS unknown
    FROM fuel_usage WHERE id > ?`).get(checkpoint.after_usage_id);
  const recent = db.prepare(`SELECT group_id, SUM(cost_usd) AS cost
    FROM fuel_usage WHERE category = 'message' AND group_id IN (
      SELECT group_id FROM fuel_groups WHERE completed = 1
    ) GROUP BY group_id
    HAVING COUNT(*) = COUNT(cost_usd) AND SUM(cost_usd) > 0
    ORDER BY MAX(id) DESC LIMIT 100`).all();
  const average = recent.length >= 5
    ? recent.reduce((total, row) => total + row.cost, 0) / recent.length : null;
  const balance = checkpoint.balance_usd === null || usage.unknown > 0 || checkpoint.tracking_gap
    ? null : checkpoint.balance_usd - usage.spent;
  return { ...checkpoint, ...usage, balance, average, samples: recent.length,
    replies: balance !== null && average ? Math.floor(Math.max(0, balance) / average) : null };
}

module.exports = { initFuel, setFuelBalance, recordFuelUsage, createMeteredOpenAI, getFuel, PRICES };
