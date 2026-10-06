const { hasAiAccess } = require('./access');
const { isConversationChannel } = require('./channel-memory');
const { SPONTANEOUS_STICKERS, SPONTANEOUS_COOLDOWN_MS } = require('./config');
const { TECHNICAL_TTL_MS } = require('./retention');

const PLAN = /(?:kto\s+(?:leci|idzie|chce)|(?:lecimy|idziemy|robimy|zbieramy|ruszamy|atakujemy|organizujemy|zorganizujmy|zróbmy|zrobmy|jedziemy|wbijamy)|(?:let['’]?s|who['’]?s\s+(?:in|coming)|anyone\s+(?:up|joining)|we['’]?re\s+(?:going|attacking)|group\s+up))/iu;
const GAME = /(?:star\s+citizen|\bsc\b|jumptown|stanton|pyro|bunk(?:ier|ry|ra|rów|row)|bunker|vanduul|xenothreat|nine\s*tails|pvp|pve|auec|hammerhead|polaris|idris|bounty|misj[aeęi]|mission|pirat|przemytn|kopani[ae]|mining)/iu;
const REAL_CONFLICT = /(?:ukrain|rosj|russia|izrael|israel|palest|gaza|real\s+(?:war|life)|prawdziw[aeą]\s+wojn)/iu;
const DECLINED = /(?:nie\s+(?:lecimy|idziemy|robimy|atakujemy|organizujemy)|(?:don['’]?t|not)\s+(?:attack|going|organis|organiz))/iu;
const BORED_LINES = [
  'Załogo? Umarliście czy znowu wszyscy liczycie SCU?',
  'Siedzę tu, zbieram kurz. Nawet mój hologram zaczyna ziewać.',
  'Halo, załogo. Sześć godzin bez zaczepki? Podejrzanie sprawnie sobie radzicie.',
];

function isGamePlan(current, previous = []) {
  const conversation = [...previous, current].join('\n');
  return PLAN.test(current) && GAME.test(conversation) &&
    !REAL_CONFLICT.test(conversation) && !DECLINED.test(current);
}

function createSpontaneousHandler({ discord, memoryDb: db, state, stickerSender,
  now = Date.now, random = Math.random, config = SPONTANEOUS_STICKERS }) {
  db.exec(`CREATE TABLE IF NOT EXISTS spontaneous_activity (
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    last_eligible_at INTEGER NOT NULL DEFAULT 0,
    last_contact_at INTEGER NOT NULL DEFAULT 0,
    last_nyx_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, channel_id)
  );`);
  const lastSpontaneousReply = state.lastSpontaneousReply ??= new Map();
  const warsInFlight = new Set();
  let ticking = false, timer;
  function remember(message, field) {
    // field jest wybierane wyłącznie przez kod, nigdy przez treść wiadomości.
    db.prepare(`INSERT INTO spontaneous_activity (guild_id, channel_id, ${field}) VALUES (?, ?, ?)
      ON CONFLICT(guild_id, channel_id) DO UPDATE SET ${field} = MAX(${field}, excluded.${field})`)
      .run(message.guild.id, message.channel.id, now());
  }
  function activity(message, addressed = false) {
    if (!message.guild || !isConversationChannel(message.channel)) return;
    if (message.author?.id === discord.user?.id) remember(message, 'last_nyx_at');
    else if (hasAiAccess(message)) {
      // Pierwsza obserwacja rozpoczyna okres ciszy; sam start procesu nie zagaduje.
      if (!db.prepare('SELECT 1 FROM spontaneous_activity WHERE guild_id = ? LIMIT 1').get(message.guild.id)) {
        remember(message, 'last_contact_at');
      }
      remember(message, 'last_eligible_at');
      if (addressed) remember(message, 'last_contact_at');
    }
  }
  function idle(row, timestamp) {
    return timestamp - Math.max(row.last_contact_at, row.last_nyx_at) >= config.BORED_IDLE_MS;
  }
  async function maybeWar(message) {
    const guildId = message.guild?.id;
    const allowed = () => hasAiAccess(message) && (message.nyxContext?.isCurrent?.() ?? true);
    if (!allowed() || !isConversationChannel(message.channel) || !PLAN.test(message.content) ||
        warsInFlight.has(guildId) || now() - (lastSpontaneousReply.get(guildId) ?? 0) < SPONTANEOUS_COOLDOWN_MS ||
        random() >= config.WAR_CHANCE) return false;
    warsInFlight.add(guildId);
    try {
      const history = await message.nyxContext?.loadHistory?.() ?? [];
      const previous = history.filter(row => row.role === 'user' &&
        now() - Date.parse(row.date) <= config.WAR_CONTEXT_MS).map(row => row.content);
      // To wtrącenie w wymianę zdań, nie reakcja na samotne słowo „wojna”.
      if (!previous.length || !isGamePlan(message.content, previous) || !allowed() ||
          now() - (lastSpontaneousReply.get(guildId) ?? 0) < SPONTANEOUS_COOLDOWN_MS) return false;
      const content = message.channel.name?.includes('lobby-int') ? "I'm ready. Just say the word."
        : 'Ja jestem gotowa. Tylko dajcie sygnał.';
      const sent = await stickerSender(message, 'war', { content, guaranteed: true });
      if (sent) {
        lastSpontaneousReply.set(guildId, now());
        remember(message, 'last_nyx_at');
      }
      return sent;
    } catch (error) {
      console.error('[Nyx] Błąd spontanicznego war:', error.message); return false;
    } finally { warsInFlight.delete(guildId); }
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const timestamp = now();
      db.prepare(`DELETE FROM spontaneous_activity WHERE MAX(last_eligible_at, last_contact_at, last_nyx_at) <= ?`)
        .run(timestamp - TECHNICAL_TTL_MS);
      for (const guild of discord.guilds.cache.values()) {
        const rows = db.prepare('SELECT * FROM spontaneous_activity WHERE guild_id = ?').all(guild.id);
        const global = { last_contact_at: Math.max(0, ...rows.map(r => r.last_contact_at)),
          last_nyx_at: Math.max(0, ...rows.map(r => r.last_nyx_at)) };
        if (!rows.length || !idle(global, timestamp) || warsInFlight.has(guild.id) ||
            random() >= config.BORED_CHANCE) continue;
        const candidates = rows.filter(row => row.last_eligible_at > timestamp - config.BORED_RECENT_ACTIVITY_MS)
          .sort((a, b) => b.last_eligible_at - a.last_eligible_at);
        for (const row of candidates) {
          const channel = guild.channels.cache.get(row.channel_id);
          if (!channel?.isTextBased?.() || !isConversationChannel(channel) ||
              !isConversationChannel(channel, config.BORED_CHANNELS)) continue;
          // Autonomiczne zagajenie nie jest przypisywane do pamięci żadnego użytkownika.
          const message = { guild, channel, reply: options => channel.send(options) };
          const content = BORED_LINES[Math.floor(random() * BORED_LINES.length)];
          if (await stickerSender(message, 'bored', { content, guaranteed: true })) {
            remember(message, 'last_nyx_at');
            lastSpontaneousReply.set(guild.id, now());
          }
          break; // Najwyżej jedna próba na serwer i cykl; brak zapasowej wiadomości bez obrazka.
        }
      }
    } catch (error) { console.error('[Nyx] Błąd spontanicznego bored:', error.message); }
    finally { ticking = false; }
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => { void tick(); }, config.BORED_CHECK_MS);
    timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }
  function contact(guildId, channelId) {
    remember({ guild: { id: guildId }, channel: { id: channelId } }, 'last_contact_at');
  }
  return { activity, maybeWar, tick, start, stop, contact };
}

module.exports = { createSpontaneousHandler, isGamePlan };
