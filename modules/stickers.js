const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FILES = Object.freeze(Object.fromEntries(
  ['focus', 'thumbup', 'salute', 'wink', 'disbelief', 'sulk', 'angry']
    .map(id => [id, path.join(__dirname, '..', 'images', `sticker-${id}-512.png`)])
));
const DAY_MS = 24 * 60 * 60 * 1000;
const CHANCE = 0.25;
function localDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
function selectSticker({ before, after, applied, points, suppressed, content, situation }) {
  if (applied && before > -20 && after === -20) return 'angry';
  if (applied && before < 20 && after === 20) return 'wink';
  if (situation === 'thumbup' && before >= 15 && content.trim().length >= 120 &&
      points > 0 && !suppressed) return 'thumbup';
  if (situation === 'salute' && before >= 15) return 'salute';
  if (situation === 'disbelief' && before >= -9) return 'disbelief';
  if (situation === 'sulk' && before <= -5) return 'sulk';
  return null;
}
function createStickerSender(db, { now = Date.now, random = Math.random,
  files = FILES, exists = fs.existsSync } = {}) {
  // Wspólne dla wszystkich kanałów i użytkowników. Restart nie odnawia limitu.
  db.exec(`CREATE TABLE IF NOT EXISTS sticker_deliveries (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, sticker TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS sticker_deliveries_day ON sticker_deliveries(day);`);
  const cooldowns = new Map();
  return async function sendSticker(message, id, { content, guaranteed = false, turn } = {}) {
    if (!files[id] || !exists(files[id]) || turn?.sent) return false;
    const timestamp = now();
    if (timestamp - (cooldowns.get(id)?.at ?? -Infinity) < DAY_MS) return false;
    if (!guaranteed && random() >= CHANCE) return false;
    const day = localDay(timestamp), token = randomUUID();
    // Rezerwacja przed await: równoległe odpowiedzi nie przekroczą limitu.
    const reservation = db.prepare(`INSERT INTO sticker_deliveries (id, day, sticker)
      SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM sticker_deliveries WHERE day = ?) < 2`)
      .run(token, day, id, day);
    if (!reservation.changes) return false;
    const oldCooldown = cooldowns.get(id);
    cooldowns.set(id, { at: timestamp, token });
    if (turn) turn.sent = true;
    try {
      await message.reply({ ...(content ? { content } : {}),
        files: [{ attachment: files[id], name: path.basename(files[id]) }],
        allowedMentions: { parse: [], repliedUser: false } });
      console.log(`[Nyx] Sticker: ${id}`);
      return true;
    } catch (error) {
      db.prepare('DELETE FROM sticker_deliveries WHERE id = ?').run(token);
      if (cooldowns.get(id)?.token === token) {
        if (oldCooldown) cooldowns.set(id, oldCooldown); else cooldowns.delete(id);
      }
      if (turn) turn.sent = false;
      console.error('[Nyx] Nie udało się wysłać stickera:', error?.message);
      return false;
    }
  };
}
module.exports = { FILES, localDay, selectSticker, createStickerSender };
