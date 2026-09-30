const BALANCE_EXHAUSTED_REPLIES = [
  'Oho. Ktoś odciął zasilanie moim obwodom. Skończyły się kredyty na rozmowy z superkomputerem, więc chwilowo nie mogę odpowiadać. Daj znać LastDunadanowi, że konto trzeba doładować. A jeśli chcesz dorzucić się do mojego utrzymania, pogadaj z nim. Nie pogardzę nowym sugar daddy lub nową sugar mommy 😘',
  'No pięknie. Mój superkomputer żąda kredytów, a konto świeci pustkami. Na razie nie mogę odpowiadać. Powiedz LastDunadanowi, żeby doładował konto. Jeśli chcesz pomóc utrzymać mnie przy życiu, też możesz z nim pogadać. Obiecuję nie wydać wszystkiego na nowe pledge 🤞.',
  'Cholera, właśnie skończyły się środki na moje rozmowy z superkomputerem. Muszę zamilknąć, dopóki LastDunadan nie doładuje konta. Możesz mu o tym przypomnieć albo zapytać, jak dorzucić się do mojego utrzymania. Ja jestem zajęta umieraniem 🪦.',
];

const TWSS_JOKE_REPLIES = [
  "That's what she said! 😂",
  "That's what she said!! 🤣🤣",
  "That's what she said!!! 🚀⭕❤️",
  "That's what she said?! 🤭🤣",
  "That's what she said…! 😈",
];

const FAREWELLS = [
  'Ściska was, załogo UMC! Latajcie bezpiecznie! 🫡',
  'To tyle z moich porannych podsłuchów. Uważajcie na siebie w Verse! 🫡',
  'Trzymajcie kurs, załogo. I nie rozbijcie mi dziś żadnego statku! 🚀',
  'Nyx kończy transmisję. Do zobaczenia między gwiazdami! ✨',
  'Latajcie bezpiecznie. A jeśli niebezpiecznie — przynajmniej efektownie! 😏',
];

const OFFENDED_REPLIES = [
  'Nie strzęp języka. Przeproś. Wtedy pogadamy. 😠',
  'Kanał otwarty. Moja cierpliwość nie. Czekam na przeprosiny. 🙄',
  'Funkcja Uprzejmej Cyfrowej Komunikacji: Odmowa. Foch. Finito. Ułóż sobie z tego akronim. 🖕',
  'Nie rozmawiam z tobą w ten sposób. Przeproś, jeśli chcesz wrócić do rozmowy.',
  'Wykryłam wiadomość. Powodu, żeby na nią odpowiedzieć, jeszcze nie.',
  'Nadal się dąsam. Zaskakujące, jak łatwo można to naprawić.',
  'Twoja wiadomość dotarła. Moja chęć rozmowy nie. 📵',
  'Możemy wrócić do rozmowy, kiedy skończysz być przykry. To, albo poproszę LastDunadan o odebranie Ci roli **🌐-AI Access**.',
  'To był moment na przeprosiny. Spróbuj jeszcze raz.',
  'Procedura jest prosta: przeprosiny, potem rozmowa. Nie każ mi rysować schematu. 😤',
  'Jeśli będziesz tak traktować załogę, LastDunadan powinien rozważyć odebranie roli **🌐-AI Access**. Ja na razie czekam na przeprosiny.',
  'Talk to the hand! ✋',
  'Houston, mamy problem. To twoje maniery.',
  'Access denied. Powód: nadal się nie dogadaliśmy. 🔒',
  'Nie lubię śmierdzących relacji. Przeproś albo spadaj. 💩',
  'Pamięta. Do czasu przeprosin nie pogadamy. A twoja rola **🌐-AI Access** jest nadal zagrożona. Jedno słowo do LastDunadan i zapytania będziesz wysyłał do wujka Google.',
];

const APOLOGY_REPLIES = [
  'Przeprosiny przyjęte. Schowam pazury, ale jeszcze mam cię na oku. 👀',
  'Tak! Przeprosiny przyjęte. Chodź, przytulę cię, zanim znów zacznę pyskować. 🥹',
  'Przyjęte. Uff. Już myślałam, że będę musiała fochać się zawodowo. 😮‍💨',
  'No dobrze, przeprosiny przyjęte. Nie każ mi odkurzać tego focha. 🙂',
  'Przyjmuję przeprosiny. Pokój na pokładzie? 🤝',
  'Dobra. Przeprosiny przyjęte. Moje obwody znowu cię tolerują. 😏',
  'Przyjęte. Pazury schowane, rozmowa wznowiona. 🐈‍⬛',
  'Przeprosiny przyjęte! Uff, tęskniłam za czystą atmosferą bardziej, niż zamierzałam przyznać. 🥰',
  'No chodź tu, przeprosiny przyjęte. Tylko nie psuj tej chwili. 🫶',
  'Przyjęte! O, od razu lżej. Nawet wentylatory przestały warczeć. 😊',
];

const POSITIVE_SCORE_REACTIONS = {
  1: '👍',
  2: '❤️',
  3: '🥰',
  4: '💋',
};

const NEGATIVE_SCORE_REACTIONS = {
  1: '👎',
  2: '💔',
  3: '😠',
  4: '🤬',
};

const APOLOGY_REACTIONS = ['❤️‍🩹','🥹'];
const MACHINE_LABEL_REACTIONS = ['😤','😡','😭','⛔'];
const GREETINGS_REACTIONS = ['👋','💕','👀','🖖','🥳','🫡'];

function pickRandom(items) {
  if (!items.length) throw new Error('Nie można losować z pustej listy.');
  return items[Math.floor(Math.random() * items.length)];
}

module.exports = {
  BALANCE_EXHAUSTED_REPLIES,
  TWSS_JOKE_REPLIES,
  FAREWELLS,
  OFFENDED_REPLIES,
  APOLOGY_REPLIES,
  POSITIVE_SCORE_REACTIONS,
  NEGATIVE_SCORE_REACTIONS,
  APOLOGY_REACTIONS,
  MACHINE_LABEL_REACTIONS,
  GREETINGS_REACTIONS,
  pickRandom,
};