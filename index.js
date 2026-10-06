require('dotenv').config();

const OpenAI = require('openai');
const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');
const state = require('./modules/state');
const personality = require('./modules/personality');
const createMessageHandler = require('./modules/messages');
const { FEATURES, NEWS_REPORT } = require('./modules/config');
const { startNewsReports } = require('./modules/news');
const { openMemory, deleteExpired } = require('./modules/memory');
const createUserReactionHandler = require('./modules/user-reactions');
const { initFuel, createMeteredOpenAI } = require('./modules/fuel');
const { createCommandHandler, registerNyxCommands } = require('./modules/commands');

if (!process.env.DISCORD_TOKEN || !process.env.OPENAI_API_KEY) {
  throw new Error('Brak DISCORD_TOKEN lub OPENAI_API_KEY w pliku .env');
}

const memoryDb = openMemory();
initFuel(memoryDb);
deleteExpired(memoryDb);

const memoryCleanupTimer = setInterval(() => {
  try {
    deleteExpired(memoryDb);
  } catch (error) {
    console.error('[Nyx] Nie udało się usunąć starych wiadomości:', error);
  }
}, 5 * 60 * 1000);

memoryCleanupTimer.unref();

const openai = createMeteredOpenAI(new OpenAI(), memoryDb);
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction],
});
discord.once(Events.ClientReady, (client) => {
  console.log(`Nyx połączona jako ${client.user.tag}`);
  void registerNyxCommands(client, NEWS_REPORT.GUILD_ID).catch(error => {
    console.error('[Nyx] Nie udało się zarejestrować /nyx:', error);
  });
  if (FEATURES.NEWS_REPORT) startNewsReports({ discord: client, openai });
});

const messageHandler = createMessageHandler({
  discord,
  openai,
  state,
  personality,
  memoryDb,
});
discord.on(Events.MessageCreate, message => {
  void openai.withFuelScope({ category: 'message', groupId: message.id },
    () => messageHandler(message)).catch(console.error);
});
discord.on(Events.InteractionCreate, createCommandHandler({ memoryDb, state, openai }));

const userReactions = createUserReactionHandler({ discord, memoryDb });
discord.on(Events.MessageReactionAdd, userReactions.onAdd);
discord.on(Events.MessageReactionRemove, userReactions.onRemove);

discord.login(process.env.DISCORD_TOKEN).catch(console.error);
