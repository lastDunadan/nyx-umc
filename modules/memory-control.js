function memoryVersion(state, userId) {
  state.memoryVersions ??= new Map();
  return state.memoryVersions.get(userId) ?? 0;
}

function forgetConversation(state, userId) {
  state.memoryVersions ??= new Map();
  state.memoryVersions.set(userId, memoryVersion(state, userId) + 1);
  for (const key of state.conversations.keys()) {
    if (key.endsWith(`:${userId}`)) state.conversations.delete(key);
  }
}

function deleteUserExchanges(db, userId, count = null) {
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 10)) {
    throw new Error('Liczba wymian musi wynosić od 1 do 10.');
  }
  const result = count === null
    ? db.prepare('DELETE FROM message_bank WHERE user_id = ?').run(userId)
    : db.prepare(`DELETE FROM message_bank WHERE user_id = ? AND id IN (
        SELECT id FROM message_bank WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
      )`).run(userId, userId, count);
  return Number(result.changes);
}

module.exports = { memoryVersion, forgetConversation, deleteUserExchanges };


function channelVersion(state, guildId, channelId) {
  return state.channelVersions?.get(`${guildId}:${channelId}`) ?? 0;
}
function forgetChannelConversation(state, guildId, channelId) {
  const prefix = `${guildId}:${channelId}`;
  state.channelVersions ??= new Map();
  state.channelVersions.set(prefix, channelVersion(state, guildId, channelId) + 1);
  for (const key of state.conversations.keys()) {
    if (key.startsWith(`${prefix}:`)) state.conversations.delete(key);
  }
  state.channelTopics?.delete(prefix);
}
module.exports.channelVersion = channelVersion;
module.exports.forgetChannelConversation = forgetChannelConversation;
