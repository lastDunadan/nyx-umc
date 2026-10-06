const TECHNICAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DISCORD_EPOCH = 1420070400000n;

// ID Discorda zawiera czas powstania wiadomości. Nie potrzebujemy tombstone'ów.
function eventMessageTimestamp(eventId) {
  const match = /^(?:reaction:|message:(?:[^:]+:)?)(\d{16,20})(?::|$)/.exec(eventId);
  return match ? Number((BigInt(match[1]) >> 22n) + DISCORD_EPOCH) : null;
}

function isExpiredEvent(eventId, now = Date.now()) {
  const timestamp = eventMessageTimestamp(eventId);
  return timestamp !== null && timestamp <= now - TECHNICAL_TTL_MS;
}

module.exports = { TECHNICAL_TTL_MS, isExpiredEvent };
