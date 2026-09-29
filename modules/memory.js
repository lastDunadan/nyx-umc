const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { canStoreExchange } = require('./privacy');

const MESSAGE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_EXCHANGES = 5;

function openMemory() {
  const file = path.join(__dirname, '..', 'data', 'nyx-memory.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      sympathy INTEGER NOT NULL DEFAULT 5
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
      INSERT INTO users (user_id, display_name)
      VALUES (?, ?)
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

module.exports = {
  openMemory,
  deleteExpired,
  getRecentExchanges,
  saveExchange,
};