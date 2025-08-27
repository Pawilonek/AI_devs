## S04E04 — Webhook Drone Navigator: Design

### Cel
Zbudować bezstanowe API (HTTPS) przyjmujące `POST { "instruction": string }`, które:
- Normalizuje i interpretuje polskojęzyczną instrukcję lotu od punktu startu (lewy górny róg mapy 4×4).
- Oblicza pozycję końcową w siatce 4×4.
- Zwraca JSON `{"description": "<max 2 słowa po polsku>"}` opisujące zawartość pola.

### Zakres i ograniczenia
- Mapę 4×4 opisujemy tekstowo, bez użycia modeli do rozpoznawania obrazów.
- Każde żądanie to niezależny lot od (0,0) — zero stanu między requestami.
- Odpowiedź w ≤15s.
- Odpowiedź wyłącznie UTF-8; wymagany kod HTTP 200.

### Reprezentacja mapy
- Układ współrzędnych: wiersze 0..3 (top→bottom), kolumny 0..3 (left→right).
- Start: (row=0, col=0).
- Przechowywanie: plik `tasks/S04E04/map.ts` z eksportem 2D tablicy stringów:
  - `const grid: string[][] = [["pole00", "..."], ...];`
  - Każda komórka zawiera docelowy opis w maks. dwóch słowach, np. "skały", "dwa drzewa".
- Do uzupełnienia po ręcznej analizie obrazka (patrz sekcja „Weryfikacja mapy”).

### Interpretacja instrukcji
1) Normalizacja tekstu
- Lowercase, usunięcie nadmiarowych spacji i prostych znaków interpunkcyjnych.
- Zastąpienia typowych fraz złożonych: np. "na sam dół" → token specjalny `DOWN_MAX`, analogicznie `UP_MAX`, `LEFT_MAX`, `RIGHT_MAX`.

2) Kierunki i synonimy (polski)
- Prawo: "prawo", "w prawo", "na prawo", "wschód".
- Lewo: "lewo", "w lewo", "na lewo", "zachód".
- Dół: "dół", "w dół", "na dół", "południe".
- Góra: "górę", "w górę", "na górę", "północ".

3) Liczebniki i ilość kroków
- Wspierane słowa/formaty: liczby arabskie (1, 2, 3, ...), słowne ("jeden", "dwa", "trzy", "cztery", "pięć", "sześć", "siedem", "osiem", "dziewięć", "dziesięć").
- Konstrukcje: "o X pól", "X pól", "X pole" (odmiana), "o jedno pole".
- Frazy do granicy: "na sam dół/górę/lewo/prawo" → ruch maksymalny do krawędzi.

4) Semantyka ruchu
- Ruch wykonywany sekwencyjnie w podanej kolejności.
- Wyjście poza siatkę: polityka „clamp” — przy próbie wyjścia zatrzymujemy się na krawędzi i kontynuujemy kolejne ruchy (nie rzucamy błędu).
- Pusta lub niejednoznaczna instrukcja: zwróć opis pola startowego.

5) Parser
- Implementacja oparta o LLM, który powinien przeanalizować podane instrukcje i zwrócić jakie ruchy powinny zostać wykonane
- Przykładowe interpretacje:
  - "poleciałem jedno pole w prawo, a później na sam dół" → moves: RIGHT×1, DOWN_MAX.
  - "2 w dół i trzy w lewo" → moves: DOWN×2, LEFT×3 (z clampingiem przy krawędzi).

### API
- Endpoint: `POST /api/dron` (bez przekierowań). Lokalnie HTTP; publiczne HTTPS
- Request JSON: `{ "instruction": "..." }`.
- Response JSON (min): `{ "description": "skały" }`.
- Status: 200 OK. Content-Type: `application/json; charset=utf-8`.
- Logowanie: metoda, ścieżka, body, wynik, oraz obliczone współrzędne.

### Implementacja serwera
- Runtime: Bun.
- Minimalny HTTP server (Bun.serve) lub lekki framework (np. Hono). Brak wymogu natywnego TLS lokalnie — warstwa HTTPS zapewniona reverse proxy (poza scopem).
- Struktura plików (proponowana):
  - `tasks/S04E04/server.ts` — serwer + routing
  - `tasks/S04E04/map.ts` — siatka 4×4 z opisami pól
  - `tasks/S04E04/parser.ts` — parser instrukcji → wektor ruchów
  - `tasks/S04E04/logic.ts` — aplikacja ruchów na siatce, clamping, wynik
  - `tasks/S04E04/report.ts` — zgłoszenie URL do Centrali (`/report`)
  - `tasks/S04E04/dev.test.ts` — testy parsera i integracyjne przykłady

Uruchomienie lokalne (dev):

```
bun run tasks/S04E04/server.ts
```

Szybki test:

```
curl -s -X POST http://localhost:3000/api/dron \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"jedno pole w prawo, potem na sam dół"}'
```

### Obsługa błędów i brzegi
- Brak/nieprawidłowy JSON: 200 z `description` pola startowego (nie przerywać scenariusza Centrali).
- Brak `instruction`: j.w.
- Wszystkie ścieżki muszą zawsze zwracać `{"description": string}`.

### Zgłoszenie do Centrali
- `POST https://c3ntrala.ag3nts.org/report`
  - Body: `{ "task": "webhook", "apikey": "<KLUCZ>", "answer": "https://twoj-publiczny-url.com/api/dron" }`
- Osobny proces/skrypt `report.ts`, odpalany dopiero po wystawieniu publicznego URL.
- Publiczny adres strony będzie konfigurowany przez .env w katalogu głownym aplikacji. Powinniśmy zaktualizować .env.example z przykładem reszta będzie zrobiona ręcznie przez administrację.

### Weryfikacja mapy
- Wymagane jest ręczne odczytanie zawartości pól 4×4 z obrazka.
- Uzupełnimy `map.ts` po tej weryfikacji. Do czasu zapełnimy placeholderami i testami parsera.

### Narzędzia: krojenie obrazu i automatyczny opis kafelków
- Skrypt: `tasks/S04E04/slice_and_describe.ts`
- Działanie:
  - Wczytuje `tasks/S04E04/mapa_s04e04.png`.
  - Tnie obraz na 4×4 i zapisuje kafelki do `tasks/S04E04/tiles/` jako `tile_r{row}_c{col}.png`.
  - Używa OpenAI Vision do wygenerowania:
    - krótkiego opisu (≤2 słowa po polsku) — do użycia bezpośrednio w `grid`.
    - dłuższego, pomocniczego opisu (10–12 słów) — do weryfikacji.
  - Zapisuje wyniki do `tasks/S04E04/tiles_descriptions.json`.
- Uruchomienie:
  - Wymagane: `OPENAI_API_KEY` w środowisku.
  - Komenda: `bun run tasks/S04E04/slice_and_describe.ts`
  - Efekty: folder `tiles/` z 16 plikami PNG i plik `tiles_descriptions.json` z opisami.

### Postęp prac nad mapą
- Wygenerowano 16 kafelków i automatyczne opisy (`tiles_descriptions.json`).
- Opisy zostały zweryfikowane ręcznie; przyjęto krótkie etykiety (≤2 słowa) dla każdego kafelka.
- Etykiety przeniesione do `tasks/S04E04/map.ts`.
- Uwaga dot. wymogu „bez rozpoznawania obrazu”:
  - OpenAI Vision wykorzystano jedynie jako narzędzie pomocnicze do wstępnego szkicu etykiet.
  - Finalny opis mapy w `map.ts` jest tekstowy, ręcznie zweryfikowany, a API nie używa Vision w trakcie działania.

### Format pliku `tasks/S04E04/map.ts`
Struktura eksportu siatki 4×4 (wiersze 0..3 z góry na dół, kolumny 0..3 z lewej na prawo):

```ts
export const grid: string[][] = [
  // row 0 (górny rząd)
  ["<r0c0>", "<r0c1>", "<r0c2>", "<r0c3>"],
  // row 1
  ["<r1c0>", "<r1c1>", "<r1c2>", "<r1c3>"],
  // row 2
  ["<r2c0>", "<r2c1>", "<r2c2>", "<r2c3>"],
  // row 3 (dolny rząd)
  ["<r3c0>", "<r3c1>", "<r3c2>", "<r3c3>"]
];
```
Każda wartość to maksymalnie dwa słowa po polsku (np. "skały", "dwa drzewa").

### Przykładowe scenariusze
- `{"instruction": "jedno pole w prawo, potem na sam dół"}` → (0,1) → (3,1) → `description` = `grid[3][1]`.
- `{"instruction": "3 w lewo i 2 w górę"}` → clamp do (0,0).

### Plan prac i przypisanie ról
- [x] Wyodrębnienie treści mapy 4×4 z obrazka i wpisanie do `map.ts`
- [x] Logika ruchu i clamping `logic.ts`
- [x] Serwer `server.ts` z logowaniem i zgodnym JSON
- [ ] Konfiguracja serwera i publikacja adresu przez człowieka
- [ ] Aktualizacja ustawień .env przez człowieka
- [ ] Zgłoszenie URL przez `report.ts` — DO ZROBIENIA (AI) po dostarczeniu publicznego URL i API key
