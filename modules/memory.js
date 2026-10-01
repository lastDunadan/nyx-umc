const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { canStoreExchange } = require('./privacy');

const MESSAGE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_EXCHANGES = 10;
const STREAK_WINDOW_MS = 2 * 60 * 60 * 1000;
const STREAK_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STREAK_LENGTH = 10;
const POSITIVE_REACTION_COOLDOWN_MS = 15 * 60 * 1000;

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

  if (!userColumns.has('last_apology_at')) {
    db.exec('ALTER TABLE users ADD COLUMN last_apology_at INTEGER');
    db.prepare('UPDATE users SET last_apology_at = ?').run(Date.now());
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

  CREATE TABLE IF NOT EXISTS conversation_streaks (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    started_at INTEGER,
    clean_count INTEGER NOT NULL DEFAULT 0,
    last_awarded_at INTEGER
  );
`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS reaction_awards (
    event_id TEXT PRIMARY KEY
      REFERENCES sympathy_events(event_id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    reversed INTEGER NOT NULL DEFAULT 0
      CHECK (reversed IN (0, 1))
  );
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
  reactionEmoji = null,
  countForStreak = false,
  isOffensive = false,
  now = Date.now(),
}) {
  if (!eventId || !userId || !Number.isInteger(points) ||
    points < -3 || points > 3) {
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
    let reactionCooldown = false;

    if (reactionEmoji !== null && change > 0) {
      const recentAward = db.prepare(`
        SELECT 1 FROM sympathy_events
        WHERE user_id = ?
          AND event_id LIKE 'reaction:%'
          AND delta > 0
          AND created_at > ?
        LIMIT 1
      `).get(userId, now - POSITIVE_REACTION_COOLDOWN_MS);
      if (recentAward) {
        change = 0;
        reactionCooldown = true;
      }
    }

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

    if (reactionEmoji !== null) {
      db.prepare(`
    INSERT INTO reaction_awards (event_id, emoji)
    VALUES (?, ?)
  `).run(eventId, reactionEmoji);
    }

    let finalSympathy = next;
    let streakDelta = 0;

    // Zliczaj tylko zakończone rozmowy, nigdy reakcje pod wiadomościami.
    if (countForStreak) {
      db.prepare(`
        INSERT OR IGNORE INTO conversation_streaks (user_id) VALUES (?)
      `).run(userId);

      const streak = db.prepare(`
        SELECT started_at, clean_count, last_awarded_at
        FROM conversation_streaks WHERE user_id = ?
      `).get(userId);

      let startedAt = streak.started_at;
      let cleanCount = streak.clean_count;
      let lastAwardedAt = streak.last_awarded_at;

      if (isOffensive || next <= -10) {
        startedAt = null;
        cleanCount = 0;
      } else {
        if (startedAt === null || now - startedAt > STREAK_WINDOW_MS) {
          startedAt = now;
          cleanCount = 0;
        }
        cleanCount++;

        if (cleanCount >= STREAK_LENGTH) {
          if (lastAwardedAt === null || now - lastAwardedAt >= STREAK_COOLDOWN_MS) {
            finalSympathy = Math.min(20, next + 1);
            streakDelta = finalSympathy - next;
            if (streakDelta > 0) {
              db.prepare(`
                INSERT INTO sympathy_events (event_id, user_id, delta, created_at)
                VALUES (?, ?, ?, ?)
              `).run(`streak:${eventId}`, userId, streakDelta, now);
              lastAwardedAt = now;
            }
          }
          startedAt = null;
          cleanCount = 0;
        }
      }

      db.prepare(`
        UPDATE conversation_streaks
        SET started_at = ?, clean_count = ?, last_awarded_at = ?
        WHERE user_id = ?
      `).run(startedAt, cleanCount, lastAwardedAt, userId);
    }

    db.prepare(`
      UPDATE users
      SET sympathy = ?,
        offended = CASE WHEN ? = -20 THEN 1 ELSE 0 END
      WHERE user_id = ?
    `).run(finalSympathy, finalSympathy, userId);

    db.exec('COMMIT');
    return {
      applied: true,
      sympathy: finalSympathy,
      delta,
      streakDelta,
      reactionCooldown,
    };
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
        probation_until = ?,
        last_apology_at = ?
      WHERE user_id = ?
    `).run(probationUntil, now, userId);

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

function getRecentMessageScoreSum(db, userId) {
  const rows = db.prepare(`
    SELECT delta
    FROM sympathy_events
    WHERE user_id = ? AND event_id LIKE 'message:%'
    ORDER BY created_at DESC, rowid DESC
    LIMIT 3
  `).all(userId);

  return rows.reduce((sum, row) => sum + row.delta, 0);
}

function undoReactionAward(db, { eventId, userId, emoji }) {
  db.exec('BEGIN IMMEDIATE');

  try {
    const award = db.prepare(`
      SELECT
        e.delta,
        e.created_at,
        a.emoji,
        a.reversed,
        u.sympathy,
        u.special,
        u.last_apology_at
      FROM sympathy_events AS e
             JOIN reaction_awards AS a ON a.event_id = e.event_id
             JOIN users AS u ON u.user_id = e.user_id
      WHERE e.event_id = ? AND e.user_id = ?
    `).get(eventId, userId);

    if (!award || award.emoji !== emoji || award.reversed) {
      db.exec('COMMIT');
      return { undone: false };
    }

    const beforeApology =
      award.last_apology_at !== null &&
      award.created_at <= award.last_apology_at;

    const blockedAtMinus20 =
      award.delta < 0 && award.sympathy === -20;

    let next = award.sympathy;

    if (!beforeApology && !blockedAtMinus20 && award.delta !== 0) {
      const minimum = award.special ? -9 : -20;

      next = Math.max(
        minimum,
        Math.min(20, award.sympathy - award.delta)
      );

      db.prepare(`
        UPDATE users
        SET sympathy = ?,
          offended = CASE WHEN ? = -20 THEN 1 ELSE 0 END
        WHERE user_id = ?
      `).run(next, next, userId);
    }

    // Zapisujemy zdjęcie także wtedy, gdy nie wolno zmienić punktów.
    // Ponowne dodanie i zdjęcie tej reakcji nic już nie zrobi.
    db.prepare(`
        UPDATE reaction_awards
        SET reversed = 1
        WHERE event_id = ?
    `).run(eventId);

    db.exec('COMMIT');

    return {
      undone: true,
      sympathy: next,
      delta: next - award.sympathy,
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
  getRecentMessageScoreSum,
  undoReactionAward,
};
