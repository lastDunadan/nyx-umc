# Nyx UMC

Prywatna AI załogi Unholy Maiden Crew na Discordzie. Rozmawia o Star Citizen, wyszukuje informacje, pamięta rozmowy na wybranych kanałach i publikuje poranny przegląd aktualizacji oraz przecieków. Osobowość Nyx znajduje się w `personality/`.

## Technologie

Node.js **24** (wersja w `.nvmrc`), CommonJS, `discord.js` 14, OpenAI Responses API, `dotenv` i wbudowane SQLite (`node:sqlite`). Zależności instaluje `npm ci` z `package-lock.json`.

## Instalacja

1. Utwórz bota w Discord Developer Portal i włącz **Message Content Intent**.
2. Dodaj bota na serwer z zakresami `bot` i `applications.commands`. Na kanałach rozmów przyznaj mu wyświetlanie kanału, czytanie historii, wysyłanie wiadomości, dodawanie reakcji oraz **Attach Files**. Na kanałach źródłowych raportu wystarczy odczyt; na docelowym potrzebny jest zapis.
3. Przydziel użytkownikom rolę **AI Access** i zezwól jej na **Używanie poleceń aplikacji**. Skopiuj ID roli w trybie deweloperskim Discorda.
4. W głównym katalogu utwórz `.env`:

   ```dotenv
   DISCORD_TOKEN=token_bota_discord
   OPENAI_API_KEY=klucz_openai_api
   AI_ACCESS_ROLE_ID=id_roli_discord
   ```

5. Uruchom:

   ```bash
   nvm use
   npm ci
   npm start
   ```

Bez `nvm` zainstaluj Node.js 24. Konto OpenAI musi mieć środki i dostęp do modelu ustawionego w kodzie. `.env`, `data/` i `node_modules/` są ignorowane przez Git.

## Konfiguracja i użycie

W `modules/config.js` ustaw kanały (najlepiej przez ID), przełączniki `FEATURES` i harmonogram `NEWS_REPORT`. Domyślnie rozmowy działają na **💬-lobby, 🌍-lobby-int, 🍻-kantyna i 🧨-offtop**; raport o 09:00 czasu polskiego czyta **💾-aktualizacje** i **💧-przecieki**. Przy kilku serwerach ustaw `NEWS_REPORT.GUILD_ID`. Bot musi działać stale, aby wykonywać harmonogramy.

Nyx reaguje na oznaczenie, odpowiedź na jej wiadomość oraz swoje imię. Rozmowy i żarty TWSS dotyczą wyłącznie osób z AI Access. Stickery są załącznikami PNG: wspólny limit **2 dziennie** dla całej aplikacji i **24h przerwy na rodzaj**; restart nie zeruje limitu dziennego.

Research najpierw szuka świeżych dowodów dla zmiennych informacji; starsze dane dopuszcza jako historyczne po nieudanej próbie. Daty, patch i linki są kontrolowane, a Flight Ready, LIVE i zakup za aUEC wymagają osobnych dowodów. Limit dwóch badań obejmuje także próbę awaryjną; kontrola metadanych nie gwarantuje poprawnej interpretacji treści źródła przez model.

Spontaniczne `war` losuje wtrącenie przy umawianiu wspólnej akcji w grze. `bored` losuje zagajenie z tekstem na lobby lub kantynie po **6h bez zaczepienia lub wypowiedzi Nyx**, jeśli była tam aktywność AI Access w ostatnich 24h. Zwykła rozmowa załogi nie zeruje tej ciszy. Progi, szanse i kanały zmienisz w `SPONTANEOUS_STICKERS`; obie scenki działają bez wywołań OpenAI.

Wybierz `/nyx` z menu komend Discorda. Odpowiedzi widzi tylko osoba wywołująca:

| Komenda | Działanie |
| --- | --- |
| `help` | Pomoc. |
| `rep` | Reputacja i opinia Nyx. |
| `clean liczba` | Usuwa 1–10 Twoich wymian na bieżącym kanale. |
| `purge` | Po potwierdzeniu usuwa Twoje wymiany ze wszystkich kanałów. |
| `privacy` | Informacje o zapisywanych danych. |
| `fuel` | Szacowane saldo i zapas odpowiedzi. |

Zmiana konfiguracji lub osobowości wymaga restartu. Model i stawki kosztów są ustawione w modułach korzystających z OpenAI oraz `modules/fuel.js`.

## Dane i koszty

SQLite powstaje automatycznie w `data/nyx-memory.sqlite`; stan raportu jest w `data/news-report.json`. Przed aktualizacją zrób kopię `data/`. Historia każdego kanału obejmuje do **20 wiadomości / 12 000 znaków / 12h**, tylko od osób z AI Access oraz powiązane odpowiedzi Nyx. Filtr danych osobowych jest heurystyczny; treści rozmów i raportów są przekazywane OpenAI.

Dane techniczne wygasają po **14 dniach**, z zachowaniem trzech ostatnich ocen wiadomości użytkownika i sum kosztów potrzebnych do salda. Reputacja i opinia pozostają. `clean` i `purge` nie kasują wiadomości na Discordzie ani danych po stronie OpenAI.

Aby ustawić pełne bieżące saldo USD z panelu OpenAI, zatrzymaj bota i wykonaj:

```bash
node scripts/set-fuel.js 10.50
```

Potem uruchom Nyx ponownie. `fuel` jest szacunkiem; wydatki innych aplikacji, doładowania i zmiany cennika wymagają korekty salda.

## Praca nad projektem

`index.js` uruchamia aplikację, `modules/` zawiera logikę, `personality/` teksty osobowości, `images/` grafiki, a `test/` testy. Uruchom `npm test` przed wysłaniem zmian. Testy działają bez Discorda i płatnych wywołań OpenAI, na izolowanych bazach SQLite.
