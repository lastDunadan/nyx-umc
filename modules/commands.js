const { randomBytes } = require('node:crypto');
const { getRelationship, deleteExpired } = require('./memory');
const { deleteUserExchanges, forgetConversation } = require('./memory-control');
const { getFuel } = require('./fuel');

const EPHEMERAL = 64;
const COMMAND = {
  name: 'nyx', description: 'Pomoc, relacja i pamięć Nyx',
  options: [
    ['help', 'Opis Nyx i lista komend'],
    ['rep', 'Twoja reputacja i zapisana opinia Nyx'],
    ['purge', 'Usuń wszystkie swoje wymiany z pamięci Nyx'],
    ['clean', 'Usuń od 1 do 10 ostatnich swoich wymian'],
    ['privacy', 'Jakie dane zapisuje Nyx?'],
    ['fuel', 'Szacowany zapas środków na API'],
  ].map(([name, description]) => ({ type: 1, name, description,
    ...(name === 'clean' ? { options: [{ type: 4, name: 'liczba',
      description: 'Liczba wymian (wiadomość i odpowiedź)', required: true,
      min_value: 1, max_value: 10 }] } : {}) })),
};

async function registerNyxCommands(discord, guildId = '') {
  const guild = guildId ? await discord.guilds.fetch(guildId)
    : discord.guilds.cache.size === 1 ? discord.guilds.cache.first() : null;
  if (!guild) throw new Error('Podaj serwer komend w NEWS_REPORT.GUILD_ID (bot widzi kilka serwerów).');
  // Aktualizujemy tylko /nyx; nie kasujemy pozostałych komend aplikacji.
  await guild.commands.create(COMMAND);
  console.log('[Nyx] Zarejestrowano /nyx na serwerze:', guild.name);
}

function reputationLabel(points) {
  if (points === -20) return 'Kontakt wstrzymany';
  if (points <= -15) return 'Otwarta wrogość';
  if (points <= -10) return 'Otwarta niechęć';
  if (points <= -5) return 'Nieufność';
  if (points < 0) return 'Lekka uraza';
  if (points < 5) return 'Neutralna relacja';
  if (points < 10) return 'Pierwsze lody przełamane';
  if (points < 15) return 'Koleżeńska sympatia';
  if (points < 20) return 'Bliska przyjaźń';
  return 'Zauroczenie';
}

function formatFuel(fuel, recordingFailed = false) {
  if (fuel.balance_usd === null) return '⛽ Saldo nie zostało jeszcze ustawione przez administratora.';
  const date = new Date(fuel.confirmed_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  if (recordingFailed || fuel.unknown > 0 || fuel.tracking_gap) {
    return `⛽ Nie mogę wiarygodnie oszacować pozostałego salda: część kosztów jest nieznana.\nOstatnie potwierdzone saldo: ${fuel.balance_usd.toFixed(2)} USD (${date}). Administrator musi sprawdzić cennik i ustawić aktualne saldo.`;
  }
  return `⛽ **Saldo szacowane: ${fuel.balance.toFixed(2)} USD**\n` +
    (fuel.replies === null ? 'Za mało danych do prognozy liczby odpowiedzi (potrzeba 5 wymian z API).'
      : `Orientacyjnie: około ${fuel.replies} odpowiedzi przy koszcie ostatnich ${fuel.samples} wymian.`) +
    `\nOstatnie potwierdzenie salda: ${date}.\nTo szacunek, nie saldo odczytane z OpenAI. Raporty i wyszukiwanie także zużywają środki; przyszłe koszty i aktywność w tle zmieniają zapas. Doładowania, wygaśnięcie kredytów i wydatki innych aplikacji wymagają korekty salda.`;
}

function createCommandHandler({ memoryDb, state, openai, infoChannel = '🌐-ai', roleId = process.env.AI_ACCESS_ROLE_ID }) {
  const confirmations = new Map();
  return async function onInteraction(interaction) {
    const command = interaction.isChatInputCommand?.() && interaction.commandName === 'nyx';
    const button = interaction.isButton?.() && interaction.customId.startsWith('nyx-purge:');
    if (!command && !button) return;
    const reply = content => interaction.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
    try {
      const roles = interaction.member?.roles;
      const allowed = roleId && (Array.isArray(roles) ? roles.includes(roleId) : roles?.cache?.has(roleId));
      if (!interaction.guild || interaction.user.bot || !allowed) {
        await reply('Ta komenda wymaga roli AI Access na serwerze UMC.');
        return;
      }
      const now = Date.now();
      for (const [id, value] of confirmations) if (value.expiresAt <= now) confirmations.delete(id);
      if (button) {
        const [, action, token] = interaction.customId.split(':');
        const confirmation = confirmations.get(token);
        if (!confirmation || confirmation.userId !== interaction.user.id || confirmation.guildId !== interaction.guildId) {
          await reply('Potwierdzenie wygasło albo należy do innej osoby. Uruchom /nyx purge ponownie.');
          return;
        }
        if (!['yes', 'no'].includes(action)) return;
        confirmations.delete(token);
        let content = 'Usuwanie anulowane.';
        if (action === 'yes') {
          const count = deleteUserExchanges(memoryDb, interaction.user.id);
          forgetConversation(state, interaction.user.id);
          content = `Usunęłam ${count} wymian i przerwałam aktywny kontekst rozmów. Reputacja i opinia pozostają bez zmian. Wiadomości na Discordzie pozostają.`;
        }
        await interaction.update({ content, components: [], allowedMentions: { parse: [] } });
        return;
      }
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'purge') {
        const token = randomBytes(12).toString('hex');
        confirmations.set(token, { userId: interaction.user.id, guildId: interaction.guildId, expiresAt: now + 60000 });
        await interaction.reply({ content: 'Usunąć wszystkie Twoje wymiany z lokalnej pamięci Nyx? Reputacja i opinia zostaną. Potwierdzenie jest ważne przez minutę.',
          flags: EPHEMERAL, allowedMentions: { parse: [] }, components: [{ type: 1, components: [
            { type: 2, style: 4, label: 'Usuń pamięć rozmów', custom_id: `nyx-purge:yes:${token}` },
            { type: 2, style: 2, label: 'Anuluj', custom_id: `nyx-purge:no:${token}` },
          ] }] });
      } else if (subcommand === 'clean') {
        deleteExpired(memoryDb);
        const count = deleteUserExchanges(memoryDb, interaction.user.id, interaction.options.getInteger('liczba', true));
        forgetConversation(state, interaction.user.id);
        await reply(`Usunęłam ${count} ostatnich wymian i przerwałam aktywny kontekst rozmów. Reputacja i opinia pozostają bez zmian. Nie usuwam wiadomości z Discorda.`);
      } else if (subcommand === 'rep') {
        const relationship = getRelationship(memoryDb, interaction.user.id);
        await reply(`**Reputacja: ${relationship.sympathy} / 20** (skala −20…20)\nRelacja: ${reputationLabel(relationship.sympathy)}\n**Zapisana opinia Nyx:**\n${relationship.opinion}`);
      } else if (subcommand === 'fuel') {
        await reply(formatFuel(getFuel(memoryDb), openai?.fuelRecordingFailed?.()));
      } else if (subcommand === 'privacy') {
        await reply('Nyx zapisuje ID Discorda, nick, reputację, opinię i status relacji oraz do 10 ostatnich wymian na maksymalnie 12 godzin. Filtr próbuje wykluczać treści z danymi osobowymi, ale może się pomylić. Zapisuje też zdarzenia punktacji, reakcje, czasowe skróty powtarzanych wiadomości i zbiorcze dane kosztów API. Treść rozmów jest przekazywana OpenAI. /nyx clean i /nyx purge usuwają lokalne wymiany; nie usuwają danych po stronie Discorda/OpenAI ani opinii i reputacji. O usunięcie pozostałych danych poproś administrację. Ta komenda nie wyświetla Twoich zapisanych rozmów.');
      } else if (subcommand === 'help') {
        const channel = interaction.guild.channels.cache.find(channel => channel.id === infoChannel || channel.name === infoChannel);
        await reply('Jestem Nyx, holograficzna AI i towarzysz rozmów załogi UMC. Pomagam z informacjami o Star Citizen i pokrewnych tematach. Wywołaj mnie przez @Nyx AI lub odpowiedź na moją wiadomość; mogę też reagować na swoje imię.\n\n' +
          '**Komendy:**\n/nyx help: pomoc\n/nyx rep: reputacja i opinia\n/nyx purge: usuń wszystkie lokalne wymiany\n/nyx clean liczba: usuń 1–10 ostatnich wymian\n/nyx privacy: zasady pamięci\n/nyx fuel: szacowany zapas środków\n\n' +
          `Więcej informacji: ${channel ? `<#${channel.id}>` : `kanał ${infoChannel}`}. Odpowiedzi na komendy widzisz tylko Ty.`);
      }
    } catch (error) {
      console.error('[Nyx] Błąd komendy:', error);
      const options = { content: 'Nie udało się wykonać komendy. Spróbuj ponownie za chwilę.', flags: EPHEMERAL, allowedMentions: { parse: [] } };
      if (!interaction.replied && !interaction.deferred) await interaction.reply(options).catch(console.error);
      else await interaction.followUp(options).catch(console.error);
    }
  };
}

module.exports = { COMMAND, registerNyxCommands, createCommandHandler, reputationLabel, formatFuel };
