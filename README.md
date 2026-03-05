# Telegram Bot

Persönlicher Telegram-Assistant auf Basis von `chat` + `hono` + AI SDK.
Der Bot verarbeitet Commands, kann Integrationen (GitHub, Notion, Google Calendar, Fitbit, Plausible) nutzen und bietet einen Agent-Modus fur freie Fragen.

## Features

- Command-basierter Bot mit Aliasen und Action-Buttons
- Agent-Modus (`/agent`) mit OpenAI (`gpt-5-nano`)
- Notion-Integration mit on-demand Retrieval (Tool-Calls statt kompletter Kontext-Inline)
- OAuth-Login-Flows für GitHub, Notion, Google und Fitbit
- Reminder/Jobs über QStash
- Telegram Webhook-Endpoint über Hono/Vercel

## Tech Stack

- Runtime: Node.js + TypeScript (`type: module`)
- Chat Layer: `chat`, `@chat-adapter/telegram`
- HTTP/API: `hono`
- LLM: `ai`, `@ai-sdk/openai`
- State/Queue: Redis + Upstash QStash

## Quickstart

Voraussetzung: [Vercel CLI](https://vercel.com/docs/cli)

```bash
npm install
vc dev
```

Danach lokal öffnen:

```bash
http://localhost:3000
```

Build lokal:

```bash
npm install
vc build
```

Deploy:

```bash
npm install
vc deploy
```

## Konfiguration

Alle benötigten Variablen stehen in `.env.example`.
Mindestens für Basisbetrieb:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `HONO_URL`

## Wichtige Commands

- `/help` Befehlsübersicht
- `/agent <frage>` direkte Agent-Antwort
- `/notion login` Notion verbinden
- `/github login` GitHub verbinden
- `/meetings login` Google Calendar verbinden
- `/fitbit login` Fitbit verbinden
- `/weather`, `/news`, `/remind`, `/analytics`, `/account`, `/clear`

## Notion im Agent-Modus

Der Agent nutzt zwei interne Tools:

- `search_notion` für relevante Seiten
- `get_page` für gezieltes Nachladen einer Seite

Dadurch werden Tokens gespart, weil nur relevante Notion-Inhalte geladen werden.
Voraussetzung: Notion verbinden (`/notion login`) und Seiten mit der Integration teilen.

## Telegram Webhook Hinweis

Um parallele Zustellungen zu reduzieren (`LOCK_FAILED`), Webhook mit einer Verbindung setzen:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/webhooks/telegram",
    "secret_token": "your-secret-token",
    "max_connections": 1
  }'
```
