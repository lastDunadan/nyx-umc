# Nyx UMC

Prywatny bot Discord organizacji Unholy Maiden Crew (UMC) ze świata *Star Citizen*. Nyx rozmawia z załogą, odpowiada na pytania z wybranego zakresu, reaguje na wiadomości i reakcje, prowadzi prostą relację z użytkownikami oraz publikuje poranny przegląd dwóch kanałów informacyjnych. Jej osobowość i zasady rozmowy są opisane w plikach `personality/`.

## Stack i wymagania

- Node.js **24** (`.nvmrc`; projekt korzysta z wbudowanego `node:sqlite`), npm i CommonJS.
- `discord.js` 14, `openai` 7 oraz `dotenv` — dokładne wersje instalowane z `package-lock.json`.
- Konto i klucz OpenAI API z dostępnym modelem używanym w kodzie (`gpt-6-luna`) oraz bot utworzony w Discord Developer Portal.
- Bot musi działać stale, jeśli ma wysłać raport o zaplanowanej godzinie. Obecny harmonogram nie nadrabia raportu po uruchomieniu po tej godzinie.

## Uruchomienie

1. W Discord Developer Portal włącz dla bota **Message Content Intent**. Dodaj go na serwer z uprawnieniami do oglądania kanałów, historii wiadomości, wysyłania wiadomości i dodawania reakcji. Do raportu potrzebny jest odczyt kanałów źródłowych i zapis na kanale docelowym. W kodzie aktywne są również `GuildMessageReactions` oraz częściowe wiadomości i reakcje.
2. Utwórz na serwerze rolę dającą zgodę na interakcje z AI. Włącz tryb deweloperski Discorda, skopiuj **ID roli** i przydziel ją osobom, które mają korzystać z Nyx. Nazwa roli nie zastępuje ID.
3. Utwórz plik `.env` w katalogu głównym:

   ```dotenv
   DISCORD_TOKEN=token_bota_discord
   OPENAI_API_KEY=klucz_openai_api
   AI_ACCESS_ROLE_ID=id_roli_discord
   ```

4. Zainstaluj zależności i uruchom aplikację:

   ```bash
   nvm use
   npm ci
   npm start
   ```

   Jeśli nie używasz `nvm`, zainstaluj Node.js 24 przed wykonaniem `npm ci`. `DISCORD_TOKEN` i `OPENAI_API_KEY` są sprawdzane przy starcie; bez poprawnego `AI_ACCESS_ROLE_ID` bot nie będzie odpowiadał członkom serwera.

Plik `.env`, katalog `data/` i `node_modules/` są ignorowane przez Git. Nie dodawaj tokenów ani bazy SQLite do repozytorium. `npm test` uruchamia testy przez `node --test`, bez połączenia z Discordem lub OpenAI; testy pamięci używają izolowanej SQLite, nie bazy bota.

## Jak działa

- Bot odpowiada na oznaczenie `@Nyx`, odpowiedź na jego wiadomość albo wzmiankę „Nyx” w treści (jeśli włączono `NAME_TRIGGER`). Może też spontanicznie ocenić dwuznaczność lub przekleństwo. Te zachowania oraz raport można włączać osobno w `FEATURES` w `modules/config.js`.
- **Bramka roli działa przed obsługą wiadomości i wywołaniami OpenAI.** Wiadomości osób bez roli wskazanej przez `AI_ACCESS_ROLE_ID` są ignorowane. Ich nowe interakcje nie trafiają do bazy. Odebranie roli nie kasuje automatycznie wcześniejszych danych.
- Reakcje pod wiadomościami Nyx mogą zmieniać `sympathy`. Przyznanie punktów jest jednorazowe na parę użytkownik–wiadomość Nyx; zdjęcie pierwotnie punktowanej reakcji może odwrócić zmianę zgodnie z regułami przeprosin i blokady.
- Odpowiedzi korzystają z OpenAI Responses API. Rozmowy mogą używać `web_search`; wiadomości z kanałów raportu są przekazywane do OpenAI w celu streszczenia. Wywołania API mogą generować koszty i podlegają limitom konta.

## Struktura projektu

| Ścieżka | Rola |
| --- | --- |
| `index.js` | Ładuje `.env`, otwiera SQLite, uruchamia klienta Discord, obsługę wiadomości i reakcji oraz opcjonalny raport; okresowo usuwa wygasłe wymiany. |
| `modules/config.js` | Przełączniki `FEATURES`, progi czasu, słowa kandydujące do spontanicznych reakcji, listy emoji i ustawienia `NEWS_REPORT`. |
| `modules/access.js`, `modules/messages.js` | Kontrola roli i kierowanie wiadomości do właściwej funkcji. |
| `modules/conversation.js`, `modules/sympathy-tone.js` | Odpowiedzi modelu, kontekst pamięci, ton relacji, punktacja i przeprosiny. |
| `modules/humor.js`, `modules/scolding.js` | Spontaniczny żart i żartobliwe strofowanie. |
| `modules/user-reactions.js`, `modules/static-replies.js` | Ocena reakcji użytkowników oraz gotowe komunikaty, pożegnania i emoji Nyx. |
| `modules/memory.js`, `modules/privacy.js`, `modules/state.js` | SQLite, filtr zapisu wymian i pamięć działającego procesu. |
| `modules/news.js`, `modules/errors-handler.js` | Poranny raport i obsługa błędów rozmowy. |
| `modules/personality.js`, `modules/personality-context.js`, `personality/*.txt` | Stały prompt i tożsamość oraz dobieranie modułów lore, statków, broni osobistej, humoru i muzyki do tematu rozmowy. |
| `modules/music.js`, `personality/nyx-music.txt` | Katalog utworów, wybór kandydatów, bezpośrednie linki YouTube i opis gustu Nyx. |
| `data/` | Tworzone lokalnie pliki bazy i stanu raportu; katalog ignorowany przez Git. |

## Gust broni a porady o sprzęcie

`personality/nyx-weapons.txt` opisuje proponowany gust Nyx: shotgun Gemini R97 jako ulubioną broń, historię Clema, romantyczną słabość do Arlingtona i zazdrość o wspólny gust z Karen Galaxy. Pozostałe preferencje dotyczą BR-2, Ravagera-212, Cody, Pulverizera, Killshota i Rippera. Są to upodobania postaci, nie ranking aktualnej mety.

Moduł `weapons` trafia do instrukcji modelu dopiero po rozpoznaniu broni osobistej, producenta, modelu lub kontekstu FPS/bunkrów. Krótkie kontynuacje zachowują temat w danej rozmowie. Dobór uzbrojenia do Arrowa i pytanie o Starfarera Gemini korzystają z modułu statków; wiadomość łącząca statek z konkretną bronią osobistą może dołączyć oba moduły. Reguły wyboru są w `modules/personality-context.js`.

W stałym `nyx-prompt.txt` jest tylko wspólna zasada oddzielania gustu od praktycznych porad. Rekomendacje mają uwzględniać aktualną wersję, potrzeby gracza, parametry, wiarygodne testy i doświadczenia społeczności, z zaznaczeniem niepewności. Nyx może odradzić własną ulubioną broń lub polecić sprzęt, którego wyglądu nie lubi. Edycja plików osobowości wymaga restartu aplikacji; moduł nie dodaje zależności ani zmian `.env` lub SQLite.

## Muzyka

Nyx dzieli się linkami do utworów; nie odtwarza dźwięku na kanałach głosowych. Przykłady: „Nyx, jaka jest Twoja ulubiona piosenka?”, „Poleć coś buntowniczego do walki!”, „Coś z dark country?” lub, po poleceniu utworu, „Daj coś innego”. „The Lost Boy” Grega Holdena jest jej ulubionym hymnem.

Gust opisuje `personality/nyx-music.txt`. Jest ładowany do instrukcji modelu tylko przy temacie muzyki. `modules/music.js` zawiera edytowalny katalog utworów i wybiera najwyżej pięciu kandydatów według tytułu, wykonawcy, tagów nastroju oraz ostatnich propozycji. Model wybiera `musicTrackId`; aplikacja dopisuje link z katalogu. Nie potrzeba nowych zależności, kluczy `.env` ani migracji bazy.

Aby dodać utwór, dopisz do `MUSIC_TRACKS` obiekt z polami `id`, `title`, `artist`, `youtubeUrl`, `tags` (tablica) i `whyNyxLikes`. Nadaj unikalne, stałe ID i sprawdź link YouTube. Opcjonalna tablica `aliases` pozwala rozpoznawać inne zapisy tytułu lub wykonawcy. Istniejące tagi oraz reguły dopasowania są w `TAG_RULES`; dla nowego nastroju możesz dodać własną regułę. Po zmianie plików uruchom bota ponownie i wykonaj `npm test`.

Bot pamięta w RAM pięć ostatnio udostępnionych ID w danej rozmowie użytkownika na kanale, przez maksymalnie 12 godzin bezczynności. Unika powtórek, o ile są inne pasujące utwory; bezpośrednia prośba o konkretny tytuł lub ulubiony hymn pozwala na powtórzenie. Restart czyści tę listę. Udostępniony link jest częścią odpowiedzi zapisywanej w zwykłej pamięci wymian, z dotychczasowym filtrem prywatności i limitem czasu. Sympatia nadal decyduje o tonie i odmowie pomocy.

## Pamięć i baza danych

`modules/memory.js` tworzy `data/nyx-memory.sqlite` przy starcie. Główne tabele to `users` (ID Discord, nick, opinia, poziom `sympathy`, flaga `special` i stan relacji), `message_bank` (ostatnie wymiany), `sympathy_events` (zdarzenia punktowe) oraz `reaction_awards` (emoji i informacja o cofnięciu punktów). Flaga `special` jest ustawiana ręcznie w bazie; bot sam jej nie przyznaje.

Na użytkownika przechowywanych jest najwyżej **10 wymian**. Wymiany starsze niż **12 godzin** są usuwane przy starcie, przy odczycie pamięci i cyklicznie co 5 minut. Zapis treści może zostać pominięty przez filtr danych osobowych (`modules/privacy.js`) i ocenę modelu. Filtr ogranicza ryzyko zapisu takich danych, ale nie gwarantuje ich wykrycia w każdej postaci. Rekordy `users` i historia zdarzeń punktowych **nie mają automatycznego terminu usunięcia**. Nick Discorda jest zapisywany w `users`; należy to opisać w regulaminie i zapewnić drogę do żądania usunięcia danych.

Przed ręczną edycją SQLite zatrzymaj bota i zachowaj kopię bazy. W DB Browser for SQLite można obejrzeć dane oraz usunąć dane konkretnego użytkownika po jego ID Discord; klucz obcy usuwa wtedy również powiązane wymiany i zdarzenia:

```sql
DELETE FROM users WHERE user_id = 'DISCORD_USER_ID';
```

## Poranny raport

Konfiguracja jest w `modules/config.js` w obiekcie `NEWS_REPORT`:

- `TIME_ZONE`, `HOUR`, `MINUTE` — strefa i godzina; domyślnie 9:00 w `Europe/Warsaw`.
- `LOOKBACK_HOURS` — okno wiadomości, domyślnie 24 godziny.
- `GUILD_ID` — ID serwera; pusty tekst działa, jeśli bot jest tylko na jednym serwerze.
- `SOURCE_CHANNELS.updates`, `SOURCE_CHANNELS.leaks` i `TARGET_CHANNEL` — nazwy albo ID kanałów. Docelowy kanał w bieżącej konfiguracji to testowy `🧨-offtop`.
- `TEST_ON_START` — wymusza publikację po starcie. **Po teście ustaw `false`**: wymuszony raport może powtórzyć się po kolejnym uruchomieniu.
- `MAX_MESSAGES_PER_CHANNEL`, `MAX_INPUT_CHARS` — limity odczytu i wejścia modelu; po ich przekroczeniu raport nie jest wysyłany.

Raport oddziela aktualności od niepotwierdzonych przecieków, dołącza odnośniki do źródłowych wiadomości i redukuje liczbę punktów, aby zmieścić się w pojedynczej wiadomości Discorda. `data/news-report.json` przechowuje klucz ostatniej wysyłki dla danego serwera, kanału i dnia, aby zapobiec zwykłym duplikatom. Kanały źródłowe mogą zawierać wpisy automatycznych źródeł; nie wymagają one roli `AI_ACCESS_ROLE_ID`. Raport publikuje aplikacja niezależnie od tego, kto ma rolę do rozmowy.

## Użycie poza UMC

Projekt jest obecnie napisany dla **jednego serwera** i ma zaszytą postać Nyx oraz lore UMC. Aby dostosować go do innej społeczności:

1. Przeredaguj `personality/nyx-prompt.txt`, `nyx-org.txt`, `nyx-ships.txt` i `nyx-humor.txt`. Zmień nazwę społeczności, zakres rozmów, historię postaci, żarty, preferencje i źródła wiedzy. Jeśli zmieniasz nazwy plików, popraw je również w `modules/personality.js`.
2. Przejrzyj teksty zależne od UMC i LastDunadan w `modules/static-replies.js`, instrukcje w `modules/conversation.js` i `modules/scolding.js` oraz nagłówek i instrukcję raportu w `modules/news.js`. Samo podmienienie plików `.txt` nie wystarczy.
3. Ustaw własne kanały, strefę czasową i godzinę w `NEWS_REPORT` oraz listy słów i emoji w `modules/config.js`. Jeśli nie potrzebujesz raportu lub spontanicznych reakcji, wyłącz odpowiednie pozycje `FEATURES`.
4. Utwórz własną rolę dostępu na nowym serwerze i wpisz jej ID w `AI_ACCESS_ROLE_ID`. Dostosuj regulamin i zasady zapisu danych do swojej społeczności.
5. Przy wdrożeniu na więcej niż jednym serwerze przejrzyj klucze pamięci i logikę dostępu: trwałe relacje są indeksowane według ID użytkownika, a domyślna konfiguracja zakłada jeden serwer. Samo wpisanie `GUILD_ID` w raporcie nie izoluje relacji między serwerami.

Identyfikator modelu (`gpt-6-luna`) jest zapisany osobno w modułach używających OpenAI. Jeśli chcesz zmienić model, sprawdź `conversation.js`, `humor.js`, `scolding.js` i `news.js` oraz przetestuj format odpowiedzi każdego z nich.


## Limity wzrostu sympatii

Skala pozostaje −20…20, nowa osoba startuje z 3; progi tonu i ochrona `special` pozostają takie jak wcześniej. Nowe reguły w `modules/memory.js`:

- Wszystkie dodatnie nagrody łącznie: najwyżej +3 w ruchomym oknie 4 godzin (wiadomości, reakcje i bonus rozmowy). Częściowa nagroda jest możliwa, np. +1 zamiast +2 przy jednym wolnym punkcie.
- Pochwała/podziękowanie: nie częściej niż raz na 15 minut na użytkownika, również między kanałami. Powtórzona treść po normalizacji wielkości liter, akcentów i interpunkcji nie daje punktów przez 24 godziny. Nie jest to semantyczny detektor parafraz; tempo i budżet ograniczają również zmienione pochwały.
- Dodatni lajk: nadal najwyżej jeden punkt na 15 minut. Pierwsza punktowana/rozpatrzona reakcja na daną wiadomość zostaje zapamiętana; ponowne dodanie nie zarabia. Cofnięcie punktu nie zwalnia wykorzystanego budżetu ani cooldownu.
- Bonus za 10 spokojnych wymian w 2 godziny: najwyżej raz na 4 godziny, w ramach wspólnego budżetu. Do ciągu zaliczane są różne treści mające co najmniej 12 liter/cyfr, najwyżej jedna na minutę; obelga resetuje ciąg. Powtarzanie „dziękuję” nie nabija bonusu.
- Ujemne punkty nadal bez dodatnich ograniczeń; probation podwaja kary, a `special` chroni minimum −9. Przeprosiny nie zerują dodatnich punktów i nie obchodzą limitów nagród.

Limity są egzekwowane transakcyjnie w SQLite i przetrwają restart. Przy starcie automatycznie dodawane są `message_fingerprints` oraz `conversation_streaks.last_counted_at`; dotychczasowe punkty nie są przeliczane. `message_fingerprints` przechowuje skrót treści po normalizacji, bez pełnej wiadomości, najwyżej 24 godziny. Skrót nie jest gwarancją anonimizacji. Usunięcie użytkownika usuwa także te rekordy. Punkty z wcześniejszych 4 godzin wliczają się do nowego budżetu.

## Osobne wyszukiwanie i koszty kontekstu

`modules/web-research.js` udostępnia modelowi Nyx funkcję `research_web`. Przy potrzebie aktualnych faktów model podaje samodzielne pytanie; osobne wywołanie tego samego modelu otrzymuje tylko krótkie `personality/basic-personality.txt`, pytanie i datę. Nie przekazujemy do niego biografii, gustów, nicku, punktów ani historii. Instrukcja nakazuje pomijać dane osobowe w pytaniu; nie jest to gwarancja ich automatycznego wykrycia.

Wynik to krótka notatka z linkami, którą Nyx wykorzystuje w swoim zwykłym tonie. Surowe wyniki narzędzia pozostają w osobnym wywołaniu. Maksymalnie dwa zapytania badawcze na odpowiedź; niekompletny wynik trafia do obsługi błędów. Badacz używa `search_context_size: low`. Pytania o gust nie wymagają wyszukiwania.

Łańcuch rozmowy resetuje się po wyszukiwaniu, zmianie modułów, 4 turach lub wejściu przekraczającym 12 000 tokenów; wtedy kontekst odbudowuje się z filtrowanej lokalnej pamięci. To usuwa kumulację wyników wyszukiwania w następnych prośbach. Historia nadal ma limit 10 wymian/12 godzin.

Wyszukiwanie w API jest płatne, także treść wyników; `previous_response_id` nie zapewnia darmowej historii. Rozdzielenie dodaje wywołanie planowania i końcowej odpowiedzi, więc oszczędność dla pojedynczego krótkiego pytania nie jest gwarantowana. Log podaje zsumowane tokeny wszystkich etapów, tokeny z cache, liczbę badań oraz wywołań web_search. Oszczędności i jakość trzeba porównać na rzeczywistych pytaniach po wdrożeniu.


## Opinia o SC, CIG i decyzja o dołączeniu

`personality/nyx-project.txt` zawiera ostrożnie optymistyczną opinię Nyx: ambicja projektu, otwarty development, finansowanie, marketing oraz własne spojrzenie na Chrisa Robertsa i Jareda Huckaby’ego (Disco Lando). Subiektywne zdanie jest oddzielone od faktów i poparte linkami do bazowych źródeł. Historyczne informacje nie określają bieżących stanowisk, finansów lub terminów: te trzeba wyszukać. Nie zapisujemy na stałe cen, kwot crowdfundingu lub dat premier.

Moduł `project` dołącza się przy pasujących pytaniach i kontynuacjach. Przykłady: „Co myślisz o Star Citizen?”, „Jak oceniasz CIG?”, „Lubisz Chrisa Robertsa?”, „Czy warto kupić SC?”. Zwykłe pytanie o broń, statek lub muzykę nie dołącza go; stałe 8970 znaków osobowości pozostaje bez zmian.

Dla zakupu dostępu do SC `modules/project-purchase.js` prowadzi ankietę:

1. Duże zainteresowanie science fiction.
2. Świadome wspieranie nieukończonego projektu i akceptacja ryzyka, że obietnice nie zostaną zrealizowane.
3. Zainteresowanie programowaniem/developmentem oraz obserwowaniem projektu ze społecznością.

Model rozpoznaje wyłącznie jawne odpowiedzi autora w bieżącej wiadomości; kod przechowuje je w RAM osobno dla użytkownika i kanału, z dotychczasowym limitem 12 godzin bezczynności. Co najmniej dwa „tak” dają rekomendację „warto rozważyć dołączenie”; dwa „nie” dają odmowę rekomendacji. Przy niewystarczających odpowiedziach obowiązuje „na razie nie” i pytania uzupełniające. Samo niejednoznaczne „tak” nie powinno odpowiedzieć na trzy pytania naraz; najlepiej używać numerów, np. „1 tak, 2 tak, 3 nie”. Rozpoznawanie wypowiedzi pozostaje zadaniem modelu; arytmetyka werdyktu jest deterministyczna.

Pytania i werdykt renderuje kod, zamiast pozwalać modelowi ominąć próg. Niezwiązane pytanie o CIG nie wyświetla ponownie ankiety. Zmiana tematu lub restart ją czyści; same odpowiedzi nie są dodawane do SQLite jako osobny profil (zwykłe wymiany nadal podlegają dotychczasowym zasadom pamięci). Ankieta nie omija negatywnej relacji wymagającej odmowy. Rekomendacja nie jest gwarancją ukończenia lub satysfakcji; wystarczy podstawowy Game Package. Nie dodano zależności, zmiennych środowiskowych ani migracji bazy.

### Prywatne komendy `/nyx`

Komenda jest rejestrowana na serwerze po uruchomieniu Nyx. Przy jednym serwerze ID jest wykrywane automatycznie; przy kilku ustaw `NEWS_REPORT.GUILD_ID`. Aktualizowana jest wyłącznie komenda `/nyx`, bez usuwania pozostałych komend aplikacji. Instalacja bota musi mieć zakres `applications.commands`, a użytkownik uprawnienie korzystania z komend aplikacji i rolę wskazaną przez `AI_ACCESS_ROLE_ID`. Widoczność komendy dla ról można dodatkowo ustawić w integracjach serwera Discord.

Wszystkie odpowiedzi są ephemeral: widzi je tylko wywołująca osoba. Komendy nie korzystają z modelu i nie naliczają reputacji.

| Komenda | Działanie |
| --- | --- |
| `/nyx help` | Opis, lista komend, instrukcja wywoływania i kanał `🌐-ai`. |
| `/nyx rep` | Reputacja, nazwa poziomu i zapisana opinia z SQLite. |
| `/nyx purge` | Usunięcie wszystkich lokalnych wymian użytkownika po potwierdzeniu przyciskiem (ważnym 60 sekund). |
| `/nyx clean liczba:3` | Usunięcie 1–10 ostatnich lokalnych wymian. Jedna wymiana to tekst użytkownika i odpowiedź Nyx. |
| `/nyx privacy` | Opis zapisywanych danych, filtrów i retencji, bez ujawniania treści rozmów. |
| `/nyx fuel` | Szacowane saldo USD i zapas odpowiedzi. |

Purge/clean zachowują opinię, reputację, flagi i zabezpieczenia przed nabijaniem punktów. Przerywają wszystkie lokalne łańcuchy rozmów tej osoby, również ankietę zakupową i kontekst muzyki. Zapytanie API trwające podczas usuwania nie odtworzy lokalnej pamięci. Wysłanej już wiadomości nie cofamy. Komendy nie kasują wiadomości na Discordzie ani zapisów po stronie OpenAI; o usunięcie pozostałych danych lokalnych należy poprosić administrację.

### Paliwo: saldo startowe i szacowanie kosztów

Po zmianach uruchomiona aplikacja automatycznie tworzy w istniejącej bazie tabele `fuel_checkpoint`, `fuel_usage` i `fuel_groups`. Nie dodawaj klucza administracyjnego OpenAI. Saldo nie jest odczytywane z panelu rozliczeń.

Aby ustawić saldo, zatrzymaj Nyx, sprawdź aktualne kredyty w panelu OpenAI i z katalogu projektu wykonaj:

```sh
node scripts/set-fuel.js 10.50
```

Następnie uruchom Nyx ponownie. Podajesz **pełne bieżące saldo**, nie kwotę ostatniego doładowania. Nowy punkt odniesienia pomija wcześniej zapisane koszty, aby ich nie odejmować drugi raz. Nie aktualizuj salda w trakcie trwających zapytań API. W DB Browser można podejrzeć `fuel_checkpoint`; do korekty używaj skryptu, który atomowo ustawia saldo, datę i granicę wcześniejszych zdarzeń.

Centralny adapter OpenAI zapisuje metryki każdego otrzymanego wyniku Responses: model, tokeny wejścia/wyjścia/cache, wywołania `web_search` i szacowany koszt. Obejmuje wieloetapowy research, rozmowy, żarty, strofowanie i raporty, również wyniki otrzymane przed późniejszym błędem aplikacji. Nie zapisuje treści promptów ani odpowiedzi w tabelach paliwa. Błąd API bez zwróconego usage nie daje pełnych danych billingowych.

Cennik jest jawnie zapisany w `modules/fuel.js`: dla `gpt-6-luna` standardowe stawki odczytane 2026-10-04 to 0.10 USD wejście, 0.01 USD cache i 0.50 USD wyjście na milion tokenów oraz 0.01 USD za wywołanie `web_search`. Źródło: https://developers.openai.com/api/docs/pricing. Sprawdzaj te wartości przy zmianie modelu, trybu lub cennika. Konteksty powyżej konserwatywnego limitu 128000 tokenów, inne modele/tryby i brak usage nie są zgadywane: wynik `/fuel` informuje wtedy o niepełnych danych zamiast pokazywać pozorne saldo. Snapshot kosztu jest zapisywany przy wywołaniu; zmiana stawek nie przelicza historycznych kosztów. Po korekcie stawek ustaw ponownie saldo z panelu.

Prognoza używa średniego kosztu maksymalnie 100 ostatnich zakończonych wymian z API (minimum 5 próbek). Kilka etapów research liczy się jako jedna wymiana; raporty obciążają saldo, ale nie zwiększają liczby próbek rozmowy. Koszt w tle nie jest prognozowany na przyszłość. SDK/retry, inne aplikacje korzystające z konta, podatki, wygaśnięcie kredytów, zmiany stawek i doładowania mogą powodować różnice: panel OpenAI pozostaje źródłem rzeczywistego salda.
