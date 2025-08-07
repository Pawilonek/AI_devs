# my

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.13. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## S03E02 (wektory) – Docker quickstart

Create `.env` with:

```
OPENAI_API_KEY=sk-...
CENTRALA_URL=https://c3ntrala.ag3nts.org
CENTRALA_SECRET=your_api_key
```

Then run:

```
docker compose up --build
```

What it does:
- launches Qdrant in Docker
- runs `tasks/S03E02/index.ts`
- expects you to unzip `weapons_tests.zip` (password `1670`) into `tasks/S03E02/weapons_tests/`
- generates OpenAI embeddings using `text-embedding-3-large` (3072 dims)
- indexes and searches in Qdrant
- reports the date to Centrala (`task: wektory`)

Manual unzip:

```
cd tasks/S03E02
unzip -P 1670 ../S03E01/pliki_z_fabryki/weapons_tests.zip -d weapons_tests
```
