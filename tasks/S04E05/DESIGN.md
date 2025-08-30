## S04E05 – Design: System do analizy notatnika Rafała

### Lista zadań (do wykonania)
- [x] Przygotuj środowisko (klucze, URL-e, zależności)
- [x] Pobierz pliki wejściowe: PDF notatnika `notatnik-rafala.pdf` i `notes.json`
- [x] Wyodrębnij tekst z PDF stron 1–18 (tekstowe)
  - [x] Skrypt: `extract_pdf_text.ts` zapisuje `context/notatnik-rafala.md` z nagłówkami stron
- [x] Przekonwertuj stronę 19 do obrazu
  - [x] Skrypt: `render_last_page.ts` zapisuje `context/notatnik-rafala_page19.png`
- [x] Wykryj skrawki strony 19 i zapisz wycinki (upright)
  - [x] Skrypt: `detect_scraps.ts` rysuje obramowania i zapisuje wycinki do `context/fragments/fragment_###.png`
- [ ] Wykonaj OCR dla strony 19 (na całości albo na wycinkach)
- [ ] Oczyść i scal tekst: strony 1–18 + wynik OCR (str. 19)
- [ ] Przygotuj kontekst i reguły promptów dla LLM (uwzględnij pułapki)
- [ ] Odpowiedz na pytania 01–05 korzystając z kontekstu
- [ ] Zaimplementuj iterację z podpowiedziami (hint) z Centrali
- [ ] Zbuduj raport w formacie JSON i wyślij na endpoint `/report`
- [ ] Dodaj logowanie, walidację, cache promptów i retry
- [ ] Włącz kontrolę jakości (human-in-the-loop) dla strony 19 i odpowiedzi granicznych
- [ ] Udostępnij skrypt CLI do uruchomienia zadania
- [x] Skrypt: pobierz `notes.json` i wypisz pytania (`list_questions.ts`)
  - [x] Zapisz pytania do `tasks/S04E05/source/questions.json`

### Struktura katalogów (S04E05)an
- `tasks/S04E05/source/` – oryginalne i wejściowe pliki: `notatnik-rafala.pdf`, `questions.json`
- `tasks/S04E05/context/` – przygotowane materiały kontekstowe do LLM: `notatnik-rafala.md` (ekstrakt)
  - `notatnik-rafala_page19.png` – wyrenderowana strona 19
  - `notatnik-rafala_page19.boxes.png` – strona 19 z narysowanymi obramowaniami detekcji
  - `fragments/fragment_###.png` – wyprostowane wycinki (upright) skrawków strony 19

---

### Cel
Zaprojektować i zbudować narzędzie, które:
1) pobierze PDF oraz listę pytań,
2) wyciągnie tekst z PDF (strony 1–18) oraz z obrazu/OCR (strona 19),
3) przygotuje spójny kontekst dla LLM,
4) wygeneruje zwięzłe odpowiedzi na pytania 01–05,
5) w razie błędów przeprowadzi iterację z uwzględnieniem `hint`,
6) wyśle wynik na endpoint Centrali.

### Wejścia i wyjścia
- Wejścia:
  - PDF: `https://c3ntrala.ag3nts.org/dane/notatnik-rafala.pdf`
  - Pytania: `https://c3ntrala.ag3nts.org/data/TUTAJ-KLUCZ/notes.json` (pobierane przez klienta Centrali z użyciem API key)
- Wyjście:
  - JSON do `/report` w formacie:
    ```json
    {
      "task": "notes",
      "apikey": "YOUR_API_KEY",
      "answer": {
        "01": "...",
        "02": "...",
        "03": "...",
        "04": "YYYY-MM-DD",
        "05": "..."
      }
    }
    ```

### Role i odpowiedzialności
- Human
  - Zweryfikuj jakość OCR strony 19 (krytyczne). Jeśli rozpoznanie nazwy miejscowości wygląda podejrzanie – sprawdź ręcznie.
  - W razie potrzeby wykonaj ręczne przycięcie/konwersję strony 19 na obraz o lepszym kontraście.
  - Gdy iteracje z `hint` utkną (wielokrotnie błędne odpowiedzi), doprecyzuj strategię promptów lub wskaż dodatkowy kontekst.
  - Zarządzaj sekretami i konfiguracją środowiska; odpal skrypt, przejrzyj logi.
- AI
  - Automatyzuje pobieranie danych, ekstrakcję tekstu, OCR, budowę kontekstu.
  - Generuje odpowiedzi na pytania 01–05, uwzględniając pułapki (01: wniosek pośredni; 03: drobny, szary tekst pod rysunkiem; 04: data względna → wyliczenie; 05: miejscowość z OCR).
  - Wykonuje iterację z `hint` i unika wcześniej odrzuconych odpowiedzi.
  - Wysyła wynik do Centrali i raportuje ewentualne podpowiedzi.

### Architektura i przepływ danych
1) Fetch:
   - Pobierz PDF bezpośrednio z URL.
   - Pobierz `notes.json` z Centrali (autoryzowane zapytanie z użyciem API key).
2) PDF → Tekst:
   - Strony 1–18: tekst; użyj ekstraktora tekstu z PDF (Node: `pdfjs-dist` lub `pdf-parse`).
3) Strona 19 → Obraz → OCR:
   - Renderuj/konwertuj stronę 19 do PNG (np. `pdfjs-dist` render to canvas/PNG; alternatywa: `pdftoppm`/`pdf2pic` jeśli dostępne).
   - OCR preferencyjnie modelem vision (OpenAI GPT-4o). Fallback: Tesseract.
   - Dodaj w promptach informację, że to dane z OCR i mogą zawierać błędy; poproś o korektę nazw własnych w kontekście pobliskich miast.
4) Konsolidacja kontekstu:
   - Połącz tekst 1–18 + OCR 19 w jeden korpus; zachowaj znaczniki stron.
   - Opcjonalnie normalizuj whitespace, usuwaj artefakty OCR, ale bez agresywnej ingerencji w treść.
5) Q&A:
   - Wczytaj pytania z `notes.json` i dla każdego wygeneruj odpowiedź z wykorzystaniem pełnego kontekstu.
   - Reguły szczególne:
     - Pytanie 01: wniosek nie wprost – wymuś u modelu wnioskowanie na podstawie treści.
     - Pytanie 03: upewnij się, że w kontekście jest drobny, szary podpis pod rysunkiem (jeśli ekstrakcja zawiedzie, dorenderuj stronę do obrazu i wykonaj OCR fragmentu).
     - Pytanie 04: data względna – policz deterministycznie w kodzie na podstawie dat w PDF (LLM do walidacji; wynik w formacie `YYYY-MM-DD`).
     - Pytanie 05: miasto z OCR (strona 19) – poinformuj model o możliwych błędach OCR; zastosuj heurystykę dopasowania do znanych miast w okolicy miasta silnie związanego z historią AIDevs.
6) Iteracja z `hint`:
   - Wyślij odpowiedzi; jeśli `/report` zwróci, że coś jest błędne i poda `hint` – dołącz zarówno błędną odpowiedź, jak i `hint` do następnego promptu dla danego pytania.
   - Instrukcja dla LLM: „Poprzednia odpowiedź Y była błędna. Podpowiedź: Z. Podaj inną odpowiedź, nie powtarzaj Y.”
   - Limituj liczbę prób (np. 3–5). Po przekroczeniu – eskalacja do Human.

### Implementacja (proponowany podział plików)
- `tasks/S04E05/index.ts` – orchestrator: pobiera dane, uruchamia ekstrakcję/OCR, Q&A, iteracje, raport.
- `tasks/S04E05/pdf.ts` – narzędzia PDF: ładowanie, ekstrakcja tekstu 1–18, render strony 19 do PNG.
- `tasks/S04E05/ocr.ts` – OCR strony 19: Vision (OpenAI), fallback Tesseract; pre/postprocessing obrazu.
- `tasks/S04E05/questions.ts` – pobranie `notes.json` z Centrali (użyj `centralaClient.getFile('notes.json')`).
- `tasks/S04E05/qa.ts` – logika Q&A nad pełnym kontekstem; obsługa wyjątków i pułapek per pytanie.
- `tasks/S04E05/date.ts` – deterministyczne wyliczenia dat (pytanie 04) w formacie `YYYY-MM-DD`.
- `tasks/S04E05/report.ts` – wysyłka na `/report` przez `centralaClient.report('notes', answers)`; obsługa odpowiedzi z hintami.
- `tasks/S04E05/types.ts` – typy: `Question`, `Answers`, `HintResponse` itp.

### Biblioteki i narzędzia
- HTTP: wbudowany klient (axios już jest w projekcie przez klienta Centrali).
- PDF (Node/Bun):
  - Preferencja: `pdfjs-dist` do tekstu i renderu strony 19 do obrazu.
  - Alternatywa: `pdf-parse` (jeśli łatwiej w Bun) – tylko tekst; do obrazu użyć `pdftoppm` (z Poppler) lub `pdf2pic` (ImageMagick/GraphicsMagick).
- OCR:
  - 1) OpenAI Vision (GPT-4o) – wysoki poziom jakości, uwzględnij prompt „to dane z OCR; możliwe błędy nazw”.
  - 2) Fallback: Tesseract CLI (`tesseract`), najlepiej z parametrami `--psm 6` i językiem `pol`.
- LLM Q/A: istniejący `openAIClient.question(...)` i `openAIClient.vision(...)`.
- Raport: `centralaClient.report(task, answer)` (już dostępny).

### Konfiguracja i środowisko
- `.env`:
  - `OPENAI_API_KEY=sk-...`
  - `CENTRALA_URL=https://c3ntrala.ag3nts.org`
  - `CENTRALA_SECRET=your_api_key`
- Uruchamianie (CLI):
  - `bun run tasks/S04E05/index.ts`

### Szczegóły kroków
1) Pobieranie
   - PDF: pobierz do pamięci lub pliku tymczasowego.
   - `notes.json`: przez `centralaClient.getFile('notes.json')`.

2) Ekstrakcja tekstu 1–18
   - Użyj `pdfjs-dist`: `getDocument` → `getPage` → `getTextContent` → scalanie `items.str` z zachowaniem podziałów na strony.
   - Walidacja: sprawdź, czy ilość znaków nie jest podejrzanie niska (fallback: alternatywna biblioteka).

3) Strona 19 → obraz → OCR
   - Render strony do PNG (np. ~2x–3x scale dla czytelności drobnego druku).
   - Vision prompt: „Odczytaj tekst z obrazu; dane z OCR mogą zawierać błędy; zwróć pełny tekst, starannie odtwórz nazwy własne; wskaż jeśli widzisz dwa fragmenty sklejone”.
   - Fallback Tesseract: `tesseract page19.png stdout -l pol --psm 6`.
   - Postprocessing: normalizacja polskich znaków, usunięcie typowych artefaktów (np. ligatur, błędów w interpunkcji), ale zachowaj oryginalny sens.

4) Konsolidacja kontekstu
   - Zbuduj blok kontekstu z nagłówkami „[Strona N]” by ułatwić referencję.
   - Dodaj notkę „Tekst ze str. 19 pochodzi z OCR i może zawierać błędy”.

5) Q&A (01–05)
   - Ogólny system prompt: „Masz kompletny tekst notatnika. Odpowiadaj zwięźle, bazując tylko na tym tekście. Jeśli odpowiedź wymaga wnioskowania – wnioskuj, ale nie fantazjuj.”
   - Per-pytanie:
     - 01: wymuś dedukcję – „nie ma wprost; wyprowadź z treści”.
     - 03: upewnij się, że drobny, szary podpis jest w kontekście; jeśli nie – spróbuj lokalnego OCR fragmentu rysunku.
     - 04: wylicz datę w kodzie; model tylko waliduje spójność. Format: `YYYY-MM-DD`.
     - 05: zaznacz, że nazwa miejscowości z OCR może być sklejona z dwóch fragmentów; poproś o próbę korekty i dopasowania do geografii (w pobliżu miasta związanego z historią AIDevs).

6) Iteracja z hint
   - Po `report`: jeżeli odpowiedź dla klucza np. "03" błędna i dostajemy `hint`, zapisz `(poprzednia_odp, hint)` i powtórz generację tylko dla tej pozycji z instrukcją „unikaj poprzedniej odpowiedzi”.
   - Prowadź licznik prób; po limicie → eskalacja do Human.

7) Raportowanie
   - Zbierz odpowiedzi w obiekcie `{"01": ..., ..., "05": ...}`.
   - Wyślij przez `centralaClient.report('notes', answers)`.
   - Loguj odpowiedź serwera; parsuj `hint` i ewentualne statusy dla iteracji.

### Wykrywanie skrawków strony 19 (zrealizowane)
- Skrypt: `tasks/S04E05/detect_scraps.ts`
- Technika:
  - Konwersja obrazu do skali szarości → rozmycie Gaussa (kernel 7)
  - Progowanie Otsu (odwrócone) → morfologiczne zamknięcie (ok. 1% rozmiaru obrazu) → dylatacja (ok. 0.6%)
  - Kontury (RETR_EXTERNAL) → `minAreaRect` → narysowanie obramowań (zielone)
  - Korekcja orientacji: normalizacja wierzchołków do [top-left, top-right, bottom-right, bottom-left] i `warpPerspective`
- Progi/parametry:
  - `minAreaRatio = 0.003`, `maxAreaRatio = 0.7` (szum odfiltrowany, duże tła pominięte)
- Artefakty wyjściowe:
  - `context/notatnik-rafala_page19.boxes.png` – strona z obramowaniami
  - `context/fragments/fragment_###.png` – wyprostowane wycinki skrawków

### Jakość, koszty, cache
- Jakość:
  - Kluczowy punkt to OCR strony 19; jeśli Vision odmówi („I can't assist”), zmień prompt na opisowy: „Opowiedz, co widzisz na obrazku; wypisz cały tekst...”.
  - Jeżeli Vision nadal ma trudność – Tesseract + ręczna weryfikacja Human.
- Koszty:
  - Użyj prompt caching: stałe fragmenty (kontekst PDF) na początku promptu.
  - Minimalizuj liczbę iteracji – generuj pojedynczo per pytanie.
- Retry i timeouty:
  - Sieć/HTTP: 3 próby z backoff.
  - LLM: 2 próby przy soft błędach; twardy błąd → eskalacja.

### Testy i walidacja
- Dry-run: zapisuj pośrednie wyniki (`extracted_p1_18.txt`, `ocr_p19.txt`, `context.txt`, `answers.json`).
- Jednostkowo (lekkie): funkcja wyliczania dat (pyt. 04) – test przykładowy na danych z PDF.
- Ręczna weryfikacja (Human): szczególnie p. 05 – poprawność miasta; p. 03 – obecność małego szarego podpisu.

### Ryzyka i obejścia
- Ekstrakcja PDF nie łapie drobnego/jaśniejszego tekstu → render do obrazu i OCR fragmentu.
- OCR skleja nazwy własne → normalizacja i heurystyki (split/join), porównanie do listy miast.
- Nieprzewidywalne `hinty` → zapisywać i dołączać dokładnie; nie powtarzać poprzedniej odpowiedzi.

### Plan wdrożenia (MVP → pełne)
1) MVP: ekstrakcja 1–18 (`pdfjs-dist`), render 19 + Vision OCR, prosty Q&A, jednokrotne raportowanie.
2) Dodaj iteracje z `hint` + retry + logi pośrednie.
3) Ulepsz OCR (Tesseract fallback) i heurystyki dla p. 05.
4) Final: testy, dokumentacja, stabilizacja promptów i cache.


