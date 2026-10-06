const { isConversationChannel, removeChannelUser } = require('./channel-memory');
const { observeChannelMessage } = require('./channel-observer');
const { forgetChannelConversation } = require('./memory-control');
const {
  FEATURES,
  HUMOR_CANDIDATE_PL,
  HUMOR_CANDIDATE_EN,
  SWEAR_CANDIDATE_PL,
  SWEAR_CANDIDATE_EN,
} = require('./config');
const createHumorHandler = require('./humor');
const createScoldingHandler = require('./scolding');
const createConversationHandler = require('./conversation');
const { hasAiAccess } = require('./access');
const { createStickerSender } = require('./stickers');
const { createSpontaneousHandler } = require('./spontaneous');

function createMessageHandler(context) {
  const { discord, state } = context;
  context = { ...context, stickerSender: context.stickerSender ?? createStickerSender(context.memoryDb) };
  const scenes = context.spontaneousHandler ?? createSpontaneousHandler(context);
  const maybeTellJoke = createHumorHandler(context);
  const maybeScold = createScoldingHandler(context);
  const respond = createConversationHandler(context);

  const onMessage = async function (message) {
    scenes.activity(message);
    if (message.author.bot || !message.guild) return;
    if (!isConversationChannel(message.channel)) return;
    if (!hasAiAccess(message)) {
      if (removeChannelUser(context.memoryDb, message.guild.id, message.channel.id, message.author.id)) {
        forgetChannelConversation(state, message.guild.id, message.channel.id);
      }
      state.relationships.delete(`${message.guild.id}:${message.author.id}`);
      for (const key of state.conversations.keys()) {
        if (key.startsWith(`${message.guild.id}:`) && key.endsWith(`:${message.author.id}`)) {
          state.conversations.delete(key);
        }
      }
      return;
    }

    // Pasted slash text must never reach the model or public reputation output.
    if (/^\/nyx(?:\s|$)/iu.test(message.content.trim())) {
      await message.reply({ content: 'Wybierz /nyx z menu poleceń Discorda, a potem podkomendę. Wpisany tekst nie uruchamia prywatnej komendy.',
        allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    message = observeChannelMessage(message, context);

    let addressedToNyx = message.mentions.has(discord.user);

    if (!addressedToNyx && message.reference?.messageId) {
      try {
        const referenced = await message.fetchReference();
        addressedToNyx = referenced.author.id === discord.user.id;
      } catch {
        // Usunięta lub niedostępna wiadomość, na którą odpowiadano.
      }
    }

    const spontaneous = FEATURES.NAME_TRIGGER && !addressedToNyx && /\bnyx\b/i.test(message.content);
    if (addressedToNyx || spontaneous) scenes.activity(message, true);

    if (FEATURES.WAR_STICKER && !addressedToNyx && !spontaneous && await scenes.maybeWar(message)) return;

    if (
      FEATURES.SWEAR_CHECK &&
      !addressedToNyx &&
      !spontaneous &&
      (
        SWEAR_CANDIDATE_PL.test(message.content) ||
        SWEAR_CANDIDATE_EN.test(message.content)
      )
    ) {
      await maybeScold(message);
      return;
    }

    if (
      FEATURES.TWSS_JOKE &&
      !addressedToNyx &&
      !spontaneous &&
      (
        HUMOR_CANDIDATE_PL.test(message.content) ||
        HUMOR_CANDIDATE_EN.test(message.content)
      )
    ) {
      await maybeTellJoke(message);
      return;
    }

    if (!addressedToNyx && !spontaneous) return;

    await respond(message, spontaneous);
  };
  onMessage.startSpontaneous = () => { if (FEATURES.BORED_STICKER) scenes.start(); };
  onMessage.stopSpontaneous = () => scenes.stop();
  onMessage.noteContact = (guildId, channelId) => scenes.contact(guildId, channelId);
  return onMessage;
}

module.exports = createMessageHandler;
