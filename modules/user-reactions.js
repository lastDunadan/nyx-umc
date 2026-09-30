const { hasAiAccess } = require('./access');
const {
  POSITIVE_USER_REACTIONS,
  NEGATIVE_USER_REACTIONS,
} = require('./config');
const { applySympathyEvent } = require('./memory');

function createUserReactionHandler({ discord, memoryDb }) {
  return async function onUserReaction(reaction, user) {
    // Własne emoji Discorda ignorujemy; listy zawierają emoji Unicode.
    const emoji = reaction.emoji.id ? null : reaction.emoji.name;
    const points = POSITIVE_USER_REACTIONS.has(emoji)
      ? 1
      : NEGATIVE_USER_REACTIONS.has(emoji) ? -1 : 0;

    if (!points) return;

    try {
      const message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;

      // Punktujemy tylko reakcje pod wiadomościami Nyx na serwerze.
      if (!message.guild || message.author?.id !== discord.user.id) return;

      const member = await message.guild.members
        .fetch({ user: user.id, force: true })
        .catch(() => null);

      if (!member || !hasAiAccess({
        guild: message.guild,
        author: member.user,
        member,
      })) return;

      const result = applySympathyEvent(memoryDb, {
        eventId: `reaction:${message.id}:${user.id}`,
        userId: user.id,
        displayName: member.displayName,
        points,
      });

      if (result.applied) {
        console.log(
          `[Nyx] Reakcja pod wiadomością Nyx: ${result.delta > 0 ? '+' : ''}${result.delta}` +
          ` | sympathy: ${result.sympathy}`
        );
      }
    } catch (error) {
      console.error('[Nyx] Nie udało się obsłużyć reakcji użytkownika:', error);
    }
  };
}

module.exports = createUserReactionHandler;