const { randomUUID } = require('node:crypto');
const { hasAiAccess } = require('./access');
const { channelVersion } = require('./memory-control');
const { saveChannelMessage, getChannelHistory, removeChannelUser } = require('./channel-memory');

// Brak wywołań modelu do zbierania kontekstu. Tylko dopuszczone wiadomości tekstowe.
function observeChannelMessage(message, { discord, memoryDb, state }) {
  const guildId = message.guild.id, channelId = message.channel.id, userId = message.author.id;
  const version = channelVersion(state, guildId, channelId);
  let permitted = true;
  let offensive = false;
  const unchanged = () => permitted && hasAiAccess(message) && version === channelVersion(state, guildId, channelId);
  const displayName = message.member?.displayName ?? message.author.globalName ?? message.author.username;
  function remember(data) {
    try { return saveChannelMessage(memoryDb, data); }
    catch (error) { console.error('[Nyx] Błąd pamięci kanału:', error?.message); return false; }
  }
  const stored = remember({ guildId, channelId, userId, messageId: message.id, displayName,
    content: message.content, referencedMessageId: message.reference?.messageId ?? null,
    now: message.createdTimestamp ?? Date.now() });
  // Nie zapisuj też odpowiedzi, gdy bieżący tekst nie przeszedł lokalnego filtra.
  permitted = stored;
  const context = {
    async loadHistory() {
      // Sprawdzenie aktualnych ról każdego właściciela przed przekazaniem kontekstu API.
      getChannelHistory(memoryDb, guildId, channelId, { excludeMessageId: message.id });
      const owners = memoryDb.prepare(`SELECT DISTINCT user_id FROM channel_messages
        WHERE guild_id = ? AND channel_id = ?`).all(guildId, channelId);
      const allowed = new Map();
      await Promise.all(owners.map(async ({ user_id: id }) => {
        try {
          const member = id === userId ? message.member
            : await message.guild.members.fetch({ user: id, force: true });
          allowed.set(id, hasAiAccess({ guild: message.guild, author: { bot: false }, member }));
        } catch { allowed.set(id, null); }
      }));
      for (const [id, access] of allowed) {
        if (access === false) removeChannelUser(memoryDb, guildId, channelId, id);
      }
      // Powtórny odczyt uwzględnia purge/wygaśnięcie podczas oczekiwania na Discord.
      return getChannelHistory(memoryDb, guildId, channelId, { excludeMessageId: message.id })
        .filter(row => allowed.get(row.ownerId) === true);
    },
    markOffensive(value) {
      offensive = Boolean(value);
      memoryDb.prepare(`UPDATE channel_messages SET is_offensive = ?
        WHERE guild_id = ? AND channel_id = ? AND exchange_id = ?`)
        .run(Number(offensive), guildId, channelId, message.id);
    },
    hasAccess: () => hasAiAccess(message),
    rejectPersonalData() {
      permitted = false;
      memoryDb.prepare(`DELETE FROM channel_messages
        WHERE guild_id = ? AND channel_id = ? AND exchange_id = ?`)
        .run(guildId, channelId, message.id);
    },
  };
  async function send(original, options) {
    const sent = await original(options);
    let content = typeof options === 'string' ? options : options?.content;
    if (!content && options?.files?.length) {
      const file = options.files[0]?.name ?? '';
      const sticker = /^sticker-(focus|thumbup|salute|wink|disbelief|sulk|angry)-512\.png$/.exec(file);
      if (sticker) content = `[Nyx wysłała sticker ${sticker[1]}.]`;
    }
    if (unchanged() && content) remember({ guildId, channelId, userId,
      authorId: discord.user.id, displayName: discord.user.username ?? 'Nyx', kind: 'nyx',
      messageId: sent?.id ?? randomUUID(), exchangeId: message.id,
      referencedMessageId: message.id, content, isOffensive: offensive });
    return sent;
  }
  const channel = new Proxy(message.channel, { get(target, key) {
    if (key === 'send') return options => send(target.send.bind(target), options);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new Proxy(message, { get(target, key) {
    if (key === 'nyxContext') return context;
    if (key === 'channel') return channel;
    if (key === 'reply') return options => send(target.reply.bind(target), options);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
module.exports = { observeChannelMessage };
