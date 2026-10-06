const { initChannelMemory, deleteExpiredChannelMessages } = require('./channel-memory');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { canStoreExchange } = require('./privacy');
const { TECHNICAL_TTL_MS, isExpiredEvent } = require('./retention');

const MESSAGE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_EXCHANGES = 10;
const STREAK_WINDOW_MS = 2 * 60 * 60 * 1000;
const STREAK_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STREAK_LENGTH = 10;
const POSITIVE_REACTION_COOLDOWN_MS = 15 * 60 * 1000;
const POSITIVE_MESSAGE_COOLDOWN_MS = 15 * 60 * 1000;
const POSITIVE_BUDGET_WINDOW_MS = 4 * 60 * 60 * 1000;
const POSITIVE_BUDGET = 3;
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const STREAK_MIN_INTERVAL_MS = 60 * 1000;

function messageFingerprint(userId, content) {
  const normalized = content.normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
}

function remainingPositiveBudget(db, userId, now) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) AS used FROM sympathy_events
    WHERE user_id = ? AND delta > 0 AND created_at > ?
  `).get(userId, now - POSITIVE_BUDGET_WINDOW_MS);
  return Math.max(0, POSITIVE_BUDGET - row.used);
}

function openMemory({ file = path.join(__dirname, '..', 'data', 'nyx-memory.sqlite') } = {}) {
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

  const streakColumns = new Set(db.prepare('PRAGMA table_info(conversation_streaks)').all()
    .map((column) => column.name));
  if (!streakColumns.has('last_counted_at')) {
    db.exec('ALTER TABLE conversation_streaks ADD COLUMN last_counted_at INTEGER');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_fingerprints (
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS message_fingerprints_date ON message_fingerprints(created_at);
  `);
  initChannelMemory(db);
  return db;
}

function deleteExpired(db, now = Date.now()) {
  deleteExpiredChannelMessages(db, now);
  db.prepare('DELETE FROM message_bank WHERE created_at <= ?')
    .run(now - MESSAGE_TTL_MS);
  db.prepare('DELETE FROM message_fingerprints WHERE created_at <= ?').run(now - REPEAT_WINDOW_MS);
  // Trzy ostatnie oceny są nadal potrzebne do zachowania logiki relacji.
  db.prepare(`DELETE FROM sympathy_events WHERE created_at <= ? AND rowid NOT IN (
    SELECT event_rowid FROM (
      SELECT rowid AS event_rowid, ROW_NUMBER() OVER (
        PARTITION BY user_id ORDER BY created_at DESC, rowid DESC
      ) AS position FROM sympathy_events WHERE event_id LIKE 'message:%'
    ) WHERE position <= 3
  )`).run(now - TECHNICAL_TTL_MS);
  db.prepare(`DELETE FROM conversation_streaks WHERE
    COALESCE(started_at, 0) <= ? AND COALESCE(last_awarded_at, 0) <= ?
    AND COALESCE(last_counted_at, 0) <= ?`)
    .run(now - TECHNICAL_TTL_MS, now - TECHNICAL_TTL_MS, now - TECHNICAL_TTL_MS);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  if (tables.has('sticker_deliveries')) {
    const { localDay } = require('./stickers');
    db.prepare('DELETE FROM sticker_deliveries WHERE day < ?').run(localDay(now - TECHNICAL_TTL_MS));
  }
  if (tables.has('fuel_usage') && tables.has('fuel_archive')) require('./fuel').compactFuelUsage(db, now);
  if (tables.has('spontaneous_activity')) {
    db.prepare(`DELETE FROM spontaneous_activity WHERE MAX(last_eligible_at, last_contact_at, last_nyx_at) <= ?`)
      .run(now - TECHNICAL_TTL_MS);
  }
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
  messageContent = '',
  isOffensive = false,
  now = Date.now(),
}) {
  if (!eventId || !userId || !Number.isInteger(points) ||
    points < -3 || points > 3) {
    throw new Error('Niepoprawne zdarzenie sympathy.');
  }
  if (isExpiredEvent(eventId, now)) {
    return { applied: false, sympathy: getRelationship(db, userId).sympathy, delta: 0 };
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
    let positiveSuppressed = false;
    let repeatedMessage = false;
    const isMessage = eventId.startsWith('message:');
    if (isMessage && typeof messageContent === 'string' && messageContent.trim()) {
      const fingerprint = messageFingerprint(userId, messageContent);
      db.prepare('DELETE FROM message_fingerprints WHERE created_at <= ?').run(now - REPEAT_WINDOW_MS);
      repeatedMessage = Boolean(db.prepare(`
        SELECT 1 FROM message_fingerprints WHERE user_id = ? AND fingerprint = ?
      `).get(userId, fingerprint));
      db.prepare(`
        INSERT INTO message_fingerprints (user_id, fingerprint, created_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id, fingerprint) DO UPDATE SET created_at = excluded.created_at
      `).run(userId, fingerprint, now);
    }
    if (isMessage && change > 0) {
      const recentAward = db.prepare(`
        SELECT 1 FROM sympathy_events WHERE user_id = ? AND event_id LIKE 'message:%'
          AND delta > 0 AND created_at > ? LIMIT 1
      `).get(userId, now - POSITIVE_MESSAGE_COOLDOWN_MS);
      if (repeatedMessage || recentAward || isOffensive || !messageContent.trim()) {
        change = 0;
        positiveSuppressed = true;
      }
    }

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
        positiveSuppressed = true;
      }
    }

    // Od -9 wzwyż użytkownik może zdobywać punkty;
    // przy -10 lub mniej potrzebuje przeprosin.
    if (change > 0 && user.sympathy <= -10) {
      change = 0;
      positiveSuppressed = true;
    }
    if (change > 0) {
      const permitted = Math.min(change, remainingPositiveBudget(db, userId, now));
      positiveSuppressed ||= permitted === 0;
      change = permitted;
    }

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
        SELECT started_at, clean_count, last_awarded_at, last_counted_at
        FROM conversation_streaks WHERE user_id = ?
      `).get(userId);

      let startedAt = streak.started_at;
      let cleanCount = streak.clean_count;
      let lastAwardedAt = streak.last_awarded_at;
      let lastCountedAt = streak.last_counted_at;

      if (isOffensive || next <= -10) {
        startedAt = null;
        cleanCount = 0;
      } else if (!repeatedMessage &&
          messageContent.replace(/[^\p{L}\p{N}]/gu, '').length >= 12 &&
          (lastCountedAt === null || now - lastCountedAt >= STREAK_MIN_INTERVAL_MS)) {
        lastCountedAt = now;
        if (startedAt === null || now - startedAt > STREAK_WINDOW_MS) {
          startedAt = now;
          cleanCount = 0;
        }
        cleanCount++;

        if (cleanCount >= STREAK_LENGTH) {
          if (lastAwardedAt === null || now - lastAwardedAt >= STREAK_COOLDOWN_MS) {
            finalSympathy = Math.min(20, next + Math.min(1, remainingPositiveBudget(db, userId, now)));
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
        SET started_at = ?, clean_count = ?, last_awarded_at = ?, last_counted_at = ?
        WHERE user_id = ?
      `).run(startedAt, cleanCount, lastAwardedAt, lastCountedAt, userId);
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
      positiveSuppressed,
      repeatedMessage,
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
    db.prepare(`DELETE FROM channel_messages WHERE user_id = ? AND is_offensive = 1`).run(userId);

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

function undoReactionAward(db, { eventId, userId, emoji, now = Date.now() }) {
  if (isExpiredEvent(eventId, now)) return { undone: false };
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
