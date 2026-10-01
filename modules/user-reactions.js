const { hasAiAccess } = require('./access');
const {
  POSITIVE_USER_REACTIONS,
  NEGATIVE_USER_REACTIONS,
} = require('./config');
const {
  applySympathyEvent,
  undoReactionAward,
} = require('./memory');

function createUserReactionHandler({ discord, memoryDb }) {
  const pending = new Map();

  async function handle(reaction, user, action) {
    try {
      const emoji = reaction.emoji.id ? null : reaction.emoji.name;
      const points = POSITIVE_USER_REACTIONS.has(emoji)
        ? 1
        : NEGATIVE_USER_REACTIONS.has(emoji) ? -1 : 0;

      if (!points) return;

      const message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;

      if (!message.guild || message.author?.id !== discord.user.id) return;

      const member = await message.guild.members
        .fetch({ user: user.id, force: true })
        .catch(() => null);

      if (!member || !hasAiAccess({
        guild: message.guild,
        author: member.user,
        member,
      })) return;

      const eventId = `reaction:${message.id}:${user.id}`;

      if (action === 'add') {
        const result = applySympathyEvent(memoryDb, {
          eventId,
          userId: user.id,
          displayName: member.displayName,
          points,
          reactionEmoji: emoji,
        });

        if (result.applied && result.delta !== 0) {
          console.log(
            `[Nyx] Reakcja: ${result.delta > 0 ? '+' : ''}${result.delta}` +
            ` | sympathy: ${result.sympathy}`
          );
        } else if (result.reactionCooldown) {
          console.log('[Nyx] Dodatnia reakcja bez punktu: limit 15 minut.');
        }
      } else {
        const result = undoReactionAward(memoryDb, {
          eventId,
          userId: user.id,
          emoji,
        });

        if (result.undone) {
          console.log(
            `[Nyx] Zdjęto punktowaną reakcję: ${result.delta}` +
            ` | sympathy: ${result.sympathy}`
          );
        }
      }
    } catch (error) {
      console.error('[Nyx] Nie udało się obsłużyć reakcji użytkownika:', error);
    }
  }

  // Zachowujemy kolejność szybkiego dodania i zdjęcia reakcji.
  function enqueue(reaction, user, action) {
    const key = `${reaction.message.id}:${user.id}`;
    const previous = pending.get(key) ?? Promise.resolve();
    const current = previous.then(() => handle(reaction, user, action));

    pending.set(key, current);
    const cleanup = () => {
      if (pending.get(key) === current) pending.delete(key);
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  return {
    onAdd: (reaction, user) => enqueue(reaction, user, 'add'),
    onRemove: (reaction, user) => enqueue(reaction, user, 'remove'),
  };
}

module.exports = createUserReactionHandler;
