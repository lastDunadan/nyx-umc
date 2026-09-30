const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { canStoreExchange } = require('./privacy');

const MESSAGE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_EXCHANGES = 10;

function openMemory() {
  const file = path.join(__dirname, '..', 'data', 'nyx-memory.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      sympathy INTEGER NOT NULL DEFAULT 3
        CHECK (sympathy BETWEEN -20 AND 20),
      special INTEGER NOT NULL DEFAULT 0
        CHECK (special IN (0, 1)),
      opinion TEXT NOT NULL DEFAULT '',
      offended INTEGER NOT NULL DEFAULT 0
        CHECK (offended IN (0, 1)),
      blocked_until INTEGER
    );

    CREATE TABLE IF NOT EXISTS message_bank (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id)
        ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      content TEXT NOT NULL,
      response TEXT NOT NULL,
      is_offensive INTEGER NOT NULL DEFAULT 0
        CHECK (is_offensive IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS message_bank_user_date
      ON message_bank(user_id, created_at);
  `);

  const userColumns = new Set(
    db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
  );

  if (!userColumns.has('probation_until')) {
    db.exec('ALTER TABLE users ADD COLUMN probation_until INTEGER');
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS sympathy_events (
    event_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    delta INTEGER NOT NULL CHECK (delta BETWEEN -6 AND 3),
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sympathy_events_user_date
    ON sympathy_events(user_id, created_at);
`);

  return db;
}

function deleteExpired(db, now = Date.now()) {
  db.prepare('DELETE FROM message_bank WHERE created_at <= ?')
    .run(now - MESSAGE_TTL_MS);
}

function getRecentExchanges(db, userId) {
  deleteExpired(db);

  return db.prepare(`
    SELECT created_at, content, response, is_offensive
    FROM message_bank
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(userId, MAX_EXCHANGES).reverse().map((row) => ({
    date: new Date(row.created_at).toISOString(),
    content: row.content,
    response: row.response,
    isOffensive: Boolean(row.is_offensive),
  }));
}

function saveExchange(db, {
  userId,
  displayName,
  content,
  response,
  containsPersonalData,
  isOffensive = false,
}) {
  if (!canStoreExchange(content, response, containsPersonalData)) {
    return false;
  }

  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');

  try {
    db.prepare(`
      INSERT INTO users (user_id, display_name, sympathy)
      VALUES (?, ?, 3)
      ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name
    `).run(userId, displayName);

    deleteExpired(db, now);

    db.prepare(`
      INSERT INTO message_bank
        (user_id, created_at, content, response, is_offensive)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, now, content, response, Number(isOffensive));

    db.prepare(`
      DELETE FROM message_bank
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM message_bank
          WHERE user_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
    `).run(userId, userId, MAX_EXCHANGES);

    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getRelationship(db, userId) {
  const row = db.prepare(`
    SELECT opinion, offended, sympathy, special
    FROM users
    WHERE user_id = ?
  `).get(userId);

  return {
    opinion: row?.opinion || 'Nie znam jeszcze tej osoby.',
    offended: Boolean(row?.offended),
    sympathy: row?.sympathy ?? 3,
    special: Boolean(row?.special),
  };
}

function saveRelationship(db, {
  userId,
  displayName,
  opinion,
  containsPersonalData,
}) {
  const candidate = typeof opinion === 'string'
    ? opinion.trim().slice(0, 200)
    : '';

  const safeOpinion =
    containsPersonalData === false &&
    candidate.length > 0 &&
    canStoreExchange(candidate, '', false);

  db.prepare(`
    INSERT INTO users (user_id, display_name, sympathy, opinion)
    VALUES (?, ?, 3, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      opinion = CASE
        WHEN ? = 1 THEN excluded.opinion
        ELSE users.opinion
      END
  `).run(
    userId,
    displayName,
    safeOpinion ? candidate : '',
    Number(safeOpinion)
  );
}

function applySympathyEvent(db, {
  eventId,
  userId,
  displayName,
  points,
  now = Date.now(),
}) {
  if (!eventId || !userId || !Number.isInteger(points) ||
    points < -3 || points > 3 || points === 0) {
    throw new Error('Niepoprawne zdarzenie sympathy.');
  }

  db.exec('BEGIN IMMEDIATE');

  try {
    db.prepare(`
      INSERT INTO users (user_id, display_name, sympathy)
      VALUES (?, ?, 3)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name
    `).run(userId, displayName);

    const user = db.prepare(`
      SELECT sympathy, special, probation_until
      FROM users WHERE user_id = ?
    `).get(userId);

    const previousEvent = db.prepare(`
      SELECT delta FROM sympathy_events WHERE event_id = ?
    `).get(eventId);

    if (previousEvent) {
      db.exec('COMMIT');
      return { applied: false, sympathy: user.sympathy, delta: 0 };
    }

    const minimum = user.special ? -9 : -20;
    if (user.sympathy < minimum) {
      throw new Error('Punkty użytkownika special są poniżej dozwolonej granicy.');
    }

    let change = points;

    // Od -10 wzwyż użytkownik może zdobywać punkty;
    // przy -10 lub mniej potrzebuje przeprosin.
    if (change > 0 && user.sympathy <= -10) change = 0;

    if (change < 0 && user.probation_until > now) {
      change *= 2;
    }

    const next = Math.max(minimum, Math.min(20, user.sympathy + change));
    const delta = next - user.sympathy;

    db.prepare(`
      INSERT INTO sympathy_events (event_id, user_id, delta, created_at)
      VALUES (?, ?, ?, ?)
    `).run(eventId, userId, delta, now);

    db.prepare(`
      UPDATE users
      SET sympathy = ?,
        offended = CASE WHEN ? = -20 THEN 1 ELSE 0 END
      WHERE user_id = ?
    `).run(next, next, userId);

    db.exec('COMMIT');
    return { applied: true, sympathy: next, delta };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function acceptApology(db, userId, now = Date.now()) {
  db.exec('BEGIN IMMEDIATE');

  try {
    const user = db.prepare(`
      SELECT sympathy, offended, probation_until
      FROM users WHERE user_id = ?
    `).get(userId);

    if (!user || (user.sympathy >= 0 && !user.offended)) {
      db.exec('COMMIT');
      return { accepted: false };
    }

    const probationUntil = user.sympathy === -20
      ? now + 48 * 60 * 60 * 1000
      : user.probation_until;

    db.prepare(`
      UPDATE users
      SET sympathy = CASE WHEN sympathy < 0 THEN 0 ELSE sympathy END,
          offended = 0,
          probation_until = ?
      WHERE user_id = ?
    `).run(probationUntil, userId);

    db.prepare(`
      DELETE FROM message_bank
      WHERE user_id = ? AND is_offensive = 1
    `).run(userId);

    db.exec('COMMIT');
    return {
      accepted: true,
      sympathy: Math.max(0, user.sympathy),
      probationUntil,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  MESSAGE_TTL_MS,
  openMemory,
  deleteExpired,
  getRecentExchanges,
  saveExchange,
  getRelationship,
  saveRelationship,
  applySympathyEvent,
  acceptApology,
};