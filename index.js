require('dotenv').config();

const OpenAI = require('openai');
const { Client, Events, GatewayIntentBits } = require('discord.js');
const state = require('./modules/state');
const personality = require('./modules/personality');
const createMessageHandler = require('./modules/messages');
const { FEATURES } = require('./modules/config');
const { startNewsReports } = require('./modules/news');

if (!process.env.DISCORD_TOKEN || !process.env.OPENAI_API_KEY) {
  throw new Error('Brak DISCORD_TOKEN lub OPENAI_API_KEY w pliku .env');
}

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
}));

discord.login(process.env.DISCORD_TOKEN).catch(console.error);