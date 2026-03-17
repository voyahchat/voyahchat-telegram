# VoyahChat Telegram Integration

Tools for managing the VoyahChat Telegram group: downloading messages for the website and syncing pinned messages from GitHub.

## Features

- **Message Download**: Download messages from Telegram topics for website publishing
- **Pinned Message Sync (MTProto)**: Sync local markdown files to Telegram via personal account
- **Pinned Message Sync (Bot API)**: Sync pinned messages via Telegram bot, triggered by GitHub Actions on push
- **Image Support**: Automatically attach images to pinned messages (same filename, e.g., `topic.md` + `topic.jpg`)
- **Resume Capability**: Interrupted downloads can be resumed
- **Dry-Run Mode**: Preview changes without applying them

## Architecture

```
┌─────────────┐    push     ┌──────────────────┐   Bot API   ┌──────────┐
│   GitHub    │ ─────────►  │  GitHub Actions  │ ──────────► │ Telegram │
│  (content)  │             │  (bot-sync.js)   │             │  (chat)  │
└─────────────┘             └──────────────────┘             └──────────┘
```

There are two pinned sync mechanisms:

| | MTProto (`pinned.js`) | Bot API (`bot-sync.js`) |
|---|---|---|
| Auth | Personal phone + session | Bot token (BotFather) |
| Runs on | Local machine | GitHub Actions (or local) |
| Edit scope | Any message | Only bot's own messages |
| Trigger | Manual | Push to `data/pinned/**` or `config/topics.yml` |
| Dependencies | `telegram` (gramJS) | None (native `fetch`) |

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Bot Sync Setup (GitHub Actions)

This is the recommended approach for collaborative pinned message management.

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Add the bot to your Telegram group as admin with `can_pin_messages` permission
3. Add secrets to your GitHub repository:
   - `TELEGRAM_BOT_TOKEN` — bot token from BotFather
   - `TELEGRAM_CHAT_ID` — numeric chat ID (e.g., `-1001234567890`)
4. Edit markdown files in `data/pinned/` and push to `main` — the bot updates Telegram automatically

#### Manual trigger

```bash
# Sync all topics
gh workflow run sync-pinned.yml

# Dry-run
gh workflow run sync-pinned.yml -f dry_run=true

# Sync specific topic
gh workflow run sync-pinned.yml -f topic=registration
```

#### Local run

```bash
# Sync all
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm run bot:sync

# Dry-run (no real token required)
npm run bot:sync:dry

# Verbose output
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm run bot:sync:debug

# Specific topic
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm run bot:sync -- -t registration
```

### 3. MTProto Sync Setup (personal account)

For editing messages published from a personal Telegram account (requires gramJS):

1. Create `config/auth.yml` from the example:
   ```bash
   cp config/auth-example.yml config/auth.yml
   ```
2. Add your phone number and run `npm run auth`
3. Sync: `npm run pinned`

### 4. Message Download

```bash
npm run auth      # First-time authentication
npm run download  # Download messages
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run bot:sync` | Sync pinned messages via Bot API |
| `npm run bot:sync:debug` | Bot sync with verbose output |
| `npm run bot:sync:dry` | Bot sync dry-run (preview only) |
| `npm run pinned` | Sync pinned messages via MTProto |
| `npm run pinned:debug` | MTProto sync with verbose output |
| `npm run pinned:dry` | MTProto sync dry-run |
| `npm run pinned:download` | Download pinned messages from Telegram |
| `npm run download` | Download messages from Telegram |
| `npm run auth` | Authenticate with Telegram |
| `npm run status` | Check authentication status |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests |

## CLI Options (bot-sync and pinned)

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show help message |
| `-v`, `--verbose` | Enable verbose output |
| `-n`, `--dry-run` | Preview changes without applying |
| `-t`, `--topic <slug>` | Sync specific topic (repeatable) |

## Configuration

### config/topics.yml

Defines forum topics and their pinned message files:

```yaml
topics:
  - title: "Registration"
    slug: registration
    topicId: 8977          # Telegram forum topic ID
    pinnedId: 747976       # MTProto pinned message ID (for pinned.js)
    botPinnedId: 1234567   # Bot's pinned message ID (managed by bot-sync)
    contentHash: abc123    # Content hash for change detection (managed by bot-sync)
    pinned: data/pinned/registration.md
```

Fields managed automatically by `bot-sync.js`:
- `botPinnedId` — set after the bot publishes or edits a message
- `contentHash` — SHA-256 hash of content + image, used to skip unchanged topics

### config/main.yml

```yaml
api_id: YOUR_API_ID
api_hash: YOUR_API_HASH
```

### config/auth.yml

```yaml
phone: '+1234567890'
session: '...'  # Saved automatically after auth
```

## Data Structure

```
data/
└── pinned/
    ├── registration.md     # Markdown content for pinned message
    ├── charging.md
    ├── charging.jpg        # Optional image (same name as .md)
    └── ...
```

Markdown files support **bold** and [links](url) syntax. The converter (`lib/markdown.js`) translates markdown to Telegram's text + entities format.

## How Bot Sync Works

1. On push to `main` (if `data/pinned/**` or `config/topics.yml` changed), GitHub Actions runs `bot-sync.js`
2. For each topic with a `pinned` field in `config/topics.yml`:
   - Reads the markdown file and computes a SHA-256 hash (includes image content if present)
   - Compares hash with stored `contentHash` — skips if unchanged
   - If `botPinnedId` exists: edits the message (or recreates if deleted)
   - If no `botPinnedId`: publishes a new message and pins it
3. Updates `config/topics.yml` with new `botPinnedId` and `contentHash`, commits with `[skip ci]`

## GitHub Actions Workflow

File: `.github/workflows/sync-pinned.yml`

- **Trigger**: Push to `main` (paths: `data/pinned/**`, `config/topics.yml`) or manual `workflow_dispatch`
- **Concurrency**: Only one sync runs at a time per branch
- **Secrets**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- **Auto-commit**: Updates `config/topics.yml` with `[skip ci]` to prevent recursive triggers

## Security

- Bot has no HTTP endpoint (no webhook) — nothing to attack
- Content comes only from repository files — no external input
- Bot token stored in GitHub Secrets — not in code
- Bot has minimal permissions: only `can_pin_messages`
- Workflow triggers only on push to `main` with path filters

## Module Structure

### Bot sync modules
- `bot-sync.js` — Bot-based pinned message sync (entry point for GitHub Actions)
- `bot-api.js` — Telegram Bot API wrapper (native `fetch`, no dependencies)

### MTProto sync modules
- `pinned.js` — Pinned message sync via gramJS/MTProto
- `pinned-download.js` — Download pinned messages from Telegram
- `entity-converter.js` — Entity converter for gramJS format

### Shared modules
- `markdown.js` — Markdown ↔ Telegram text+entities converter
- `topics-config.js` — Topics configuration loader/saver
- `logger.js` — Logger with verbose mode and progress display

### Download modules
- `download.js` — Main downloader class
- `download-index.js`, `download-links.js`, `download-media.js`, `download-message.js`, `download-utils.js`

### Core modules
- `auth.js` — Authentication CLI
- `config.js` — Configuration loader
- `constants.js` — Module constants
- `logger-guard.js` — Console output suppression for gramJS
- `telegram-utils.js` — Shared Telegram utilities

## Troubleshooting

### Bot sync: "message to edit not found"
The bot's message was deleted from Telegram. Bot-sync will automatically recreate it and update `botPinnedId` in config.

### Bot sync: messages go to wrong topic
Check that `topicId` in `config/topics.yml` matches the actual forum topic ID in Telegram.

### Bot sync: no formatting in messages
Ensure markdown uses `**bold**` and `[text](url)` syntax. The converter produces Telegram entities from these patterns.

### Download timeouts
Large media files may timeout. Try increasing `timeoutMaxMs` in `config/download.yml`.

### Session expired
Delete the `session` field from `config/auth.yml` and run `npm run auth` again.

### Rate limiting
Increase `rateLimitDelayMs` in download config. Bot-sync has a built-in 500ms delay between topics.
