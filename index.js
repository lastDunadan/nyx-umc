require('dotenv').config();

const OpenAI = require('openai');
const { Client, Events, GatewayIntentBits } = require('discord.js');
const state = require('./modules/state');
const personality = require('./modules/personality');
const createMessageHandler = require('./modules/messages');
const { FEATURES } = require('./modules/config');
const { startNewsReports } = require('./modules/news');
const { openMemory, deleteExpired } = require('./modules/memory');

if (!process.env.DISCORD_TOKEN || !process.env.OPENAI_API_KEY) {
  throw new Error('Brak DISCORD_TOKEN lub OPENAI_API_KEY w pliku .env');
}

const memoryDb = openMemory();
deleteExpired(memoryDb);

const memoryCleanupTimer = setInterval(() => {
  try {
    deleteExpired(memoryDb);
  } catch (error) {
    console.error('[Nyx] Nie udało się usunąć starych wiadomości:', error);
  }
}, 5 * 60 * 1000);

memoryCleanupTimer.unref();

const openai = new OpenAI();
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discord.once(Events.ClientReady, (client) => {
  console.log(`Nyx połączona jako ${client.user.tag}`);
  if (FEATURES.NEWS_REPORT) startNewsReports({ discord: client, openai });
});

discord.on(Events.MessageCreate, createMessageHandler({
  discord,
  openai,
  state,
  personality,
  memoryDb,
}));

discord.login(process.env.DISCORD_TOKEN).catch(console.error);