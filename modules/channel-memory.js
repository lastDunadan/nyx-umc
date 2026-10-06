const { canStoreExchange } = require('./privacy');
const { CHAT_MEMORY } = require('./config');
const TTL_MS = 12 * 60 * 60 * 1000;
const INTRODUCES_PERSONAL_DATA = /(?:mam na imi[eę]|nazywam si[eę]|my name is|m[oó]j adres|my address|m[oó]j numer telefonu)(?!\p{L})/iu;

function isConversationChannel(channel, allowed = CHAT_MEMORY.CHANNELS) {
  const name = String(channel?.name ?? '').replace(/[\u200b-\u200f\u2060\ufe0f]/gu, '');
  return allowed.some(value => value === channel?.id || value.replace(/[\u200b-\u200f\u2060\ufe0f]/gu, '') === name);
}
function initChannelMemory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS channel_messages (
    id INTEGER PRIMARY KEY,
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    author_id TEXT NOT NULL, display_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('user', 'nyx')),
    exchange_id TEXT NOT NULL, referenced_message_id TEXT,
    created_at INTEGER NOT NULL, content TEXT NOT NULL,
    is_offensive INTEGER NOT NULL DEFAULT 0 CHECK (is_offensive IN (0, 1)),
    UNIQUE (guild_id, channel_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS channel_messages_date ON channel_messages(guild_id, channel_id, created_at);
  CREATE INDEX IF NOT EXISTS channel_messages_owner ON channel_messages(guild_id, channel_id, user_id);`);
}
function deleteExpiredChannelMessages(db, now = Date.now()) {
  db.prepare('DELETE FROM channel_messages WHERE created_at <= ?').run(now - TTL_MS);
}
function saveChannelMessage(db, { guildId, channelId, messageId, userId, authorId = userId,
  displayName, kind = 'user', exchangeId = messageId, referencedMessageId = null,
  content, containsPersonalData = false, isOffensive = false, now = Date.now() }) {
  if (![guildId, channelId, messageId, userId, authorId, exchangeId].every(value => typeof value === 'string' && value)) {
    throw new Error('Brak identyfikatorów wiadomości kanału.');
  }
  if (typeof content !== 'string' || !content.trim() || content.length > CHAT_MEMORY.MAX_MESSAGE_CHARS ||
      INTRODUCES_PERSONAL_DATA.test(content) || !canStoreExchange(content, '', containsPersonalData)) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    deleteExpiredChannelMessages(db, now);
    db.prepare(`INSERT INTO users (user_id, display_name, sympathy) VALUES (?, ?, 3)
      ON CONFLICT(user_id) DO NOTHING`).run(userId, String(displayName ?? userId));
    db.prepare(`INSERT OR IGNORE INTO channel_messages
      (guild_id, channel_id, message_id, user_id, author_id, display_name, kind, exchange_id, referenced_message_id, created_at, content, is_offensive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(guildId, channelId, messageId, userId, authorId, String(displayName ?? authorId), kind,
        exchangeId, referencedMessageId, now, content, Number(Boolean(isOffensive)));
    db.prepare(`DELETE FROM channel_messages WHERE guild_id = ? AND channel_id = ? AND id NOT IN (
      SELECT id FROM channel_messages WHERE guild_id = ? AND channel_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    )`).run(guildId, channelId, guildId, channelId, CHAT_MEMORY.MAX_MESSAGES);
    // Budżet dotyczy serializowanej treści wraz z nazwami i identyfikatorami.
    let rows = readRows(db, guildId, channelId);
    while (rows.length && JSON.stringify(rows.map(formatRow)).length > CHAT_MEMORY.MAX_CONTEXT_CHARS) {
      db.prepare('DELETE FROM channel_messages WHERE id = ?').run(rows.shift().id);
    }
    db.exec('COMMIT'); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function readRows(db, guildId, channelId) {
  return db.prepare(`SELECT * FROM channel_messages WHERE guild_id = ? AND channel_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(guildId, channelId, CHAT_MEMORY.MAX_MESSAGES).reverse();
}
function formatRow(row) {
  return { id: row.message_id, ownerId: row.user_id, isOffensive: Boolean(row.is_offensive), authorId: row.author_id, author: row.display_name, role: row.kind,
    replyTo: row.referenced_message_id, exchangeId: row.exchange_id,
    date: new Date(row.created_at).toISOString(), content: row.content };
}
function getChannelHistory(db, guildId, channelId, { excludeMessageId, now = Date.now() } = {}) {
  deleteExpiredChannelMessages(db, now);
  return readRows(db, guildId, channelId).filter(row => row.message_id !== excludeMessageId).map(formatRow);
}
function removeChannelUser(db, guildId, channelId, userId) {
  return db.prepare('DELETE FROM channel_messages WHERE guild_id = ? AND channel_id = ? AND user_id = ?')
    .run(guildId, channelId, userId).changes;
}
function deleteChannelExchanges(db, { guildId, channelId, userId, count = null }) {
  if (![guildId, channelId, userId].every(value => typeof value === 'string' && value) ||
      (count !== null && (!Number.isInteger(count) || count < 1 || count > 10))) throw new Error('Niepoprawny zakres usuwania pamięci.');
  const groups = db.prepare(`SELECT exchange_id FROM channel_messages
    WHERE guild_id = ? AND channel_id = ? AND user_id = ?
    GROUP BY exchange_id ORDER BY MAX(created_at) DESC, MAX(id) DESC LIMIT ?`)
    .all(guildId, channelId, userId, count ?? -1);
  db.exec('BEGIN IMMEDIATE');
  try {
    const remove = db.prepare(`DELETE FROM channel_messages
      WHERE guild_id = ? AND channel_id = ? AND user_id = ? AND exchange_id = ?`);
    for (const row of groups) remove.run(guildId, channelId, userId, row.exchange_id);
    db.exec('COMMIT'); return groups.length;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function deleteAllUserExchanges(db, userId) {
  if (typeof userId !== 'string' || !userId) throw new Error('Brak użytkownika.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT guild_id, channel_id, exchange_id FROM channel_messages
      WHERE user_id = ? GROUP BY guild_id, channel_id, exchange_id
    )`).get(userId).count;
    db.prepare('DELETE FROM channel_messages WHERE user_id = ?').run(userId);
    const legacy = db.prepare('DELETE FROM message_bank WHERE user_id = ?').run(userId).changes;
    db.exec('COMMIT'); return count + Number(legacy);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { initChannelMemory, deleteExpiredChannelMessages, saveChannelMessage,
  getChannelHistory, deleteChannelExchanges, deleteAllUserExchanges, removeChannelUser, isConversationChannel };
