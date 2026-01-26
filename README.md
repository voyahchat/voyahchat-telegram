# Telegram Integration

This module downloads messages from the VoyahChat Telegram group for publishing on the website.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create authentication config:
   ```bash
   cp config/auth-example.yml config/auth.yml
   ```

3. Edit `config/auth.yml` and add your phone number:
   ```yaml
   phone: '+1234567890'
   ```

4. Authenticate with Telegram:
   ```bash
   npm run auth
   ```
   - Enter the verification code from Telegram app or SMS
   - If 2FA is enabled, enter your password
   - Session will be saved automatically

5. Download messages:
   ```bash
   npm run download
   ```

## NPM Scripts

- `npm run auth` - Authentication CLI script
- `npm run status` - Check authentication status
- `npm run download` - Download messages from Telegram
- `npm run pinned` - Sync local markdown files to Telegram pinned messages
- `npm run pinned:debug` - Pinned sync with verbose output
- `npm run pinned:dry` - Pinned sync dry-run mode
- `npm run lint` - Run ESLint
- `npm run test` - Run tests

## Configuration Files

The project uses four separate configuration files:

1. `config/main.yml` - API credentials (api_id, api_hash)
2. `config/topics.yml` - Topic definitions with titles, slugs, topicIds, pinnedIds
3. `config/download.yml` - Download settings and section list
4. `config/auth.yml` - Authentication (phone, session) - created from auth-example.yml

## Features

- **Resume Capability**: Interrupted downloads can be resumed
- **Integrity Checking**: Validates downloaded files on each run
- **Media Downloads**: Automatically downloads images, videos, and documents
- **Timeout Handling**: Large files have configurable timeout with retries
- **Progress Tracking**: Saves progress after each section
- **Statistics**: Detailed download statistics and error tracking
- **Pinned Message Sync**: Sync local markdown files with Telegram pinned messages

## Pinned Message Sync

The pinned sync feature allows you to maintain pinned messages in Telegram topics by editing local markdown files.

### Commands
- `npm run pinned` - Sync all markdown files to their corresponding pinned messages
- `npm run pinned:debug` - Sync with verbose output for troubleshooting
- `npm run pinned:dry` - Dry-run mode to preview changes without applying them

### CLI Options
- `-h/--help` - Show help information
- `-v/--verbose` - Enable verbose output
- `-n/--dry-run` - Preview changes without applying them
- `-t/--topic <slug>` - Sync only a specific topic

### Configuration
Add a `pinned` field to topics in `config/topics.yml` pointing to the markdown file:
```yaml
topics:
  - title: "Topic Title"
    slug: topic-slug
    pinned: data/pinned/topic.md  # Path to markdown file
    topicId: 12345
    pinnedId: 67890
```

### Image Support
If an image file with the same name as the markdown file exists (e.g., `topic.jpg`), it will be automatically uploaded and attached to the pinned message.

## Output Structure

```
downloaded/
├── index.json
├── sections/
│   └── <section-slug>/
│       ├── <messageId>.json
│       ├── pinned.json
│       ├── metadata.json
│       ├── referenced/
│       │   └── <messageId>.json
│       ├── media/
│       │   └── <messageId>.<ext>
│       └── links/
│           └── scraper-cache.json
└── private/
    └── <channel-slug>/
        ├── <messageId>.json
        ├── metadata.json
        └── media/
```

## Data Directory Structure

```
data/
└── pinned/
    ├── topic.md      # Markdown content for pinned message
    └── topic.jpg     # Optional image for pinned message
```

## Configuration Examples

### config/main.yml
```yaml
api_id: YOUR_API_ID
api_hash: YOUR_API_HASH
```

### config/topics.yml
```yaml
topics:
  - title: "Topic Title"
    slug: topic-slug
    pinned: data/pinned/topic.md  # Optional: for pinned sync
    topicId: 12345
    pinnedId: 67890
```

### config/download.yml
```yaml
settings:
  maxRetries: 10
  retryDelayBaseMs: 2000
  # ... other settings

chat:
  name: chatname
  sections:
    - slug: section-slug
    # ... other sections

channel:
  name: "Private Channel"
  slug: "private-channel"
  inviteHash: "INVITE_HASH"
```

### Download Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| maxRetries | 10 | Maximum retry attempts for failed downloads |
| retryDelayBaseMs | 2000 | Base delay between retries (exponential backoff) |
| retryDelayMaxMs | 60000 | Maximum delay between retries |
| retryJitterMs | 1000 | Random jitter added to retry delay |
| timeoutBaseMs | 60000 | Base timeout for downloads |
| timeoutPerMbMs | 30000 | Additional timeout per MB of file size |
| timeoutMaxMs | 600000 | Maximum timeout for any download |
| connectionRetries | 5 | Connection retry attempts |
| connectionTimeoutMs | 30000 | Connection timeout |
| messagesPerRequest | 100 | Messages to fetch per API request |
| rateLimitDelayMs | 1000 | Delay between API requests |

## Module Structure

### Core modules
- `auth.js` - Authentication CLI script
- `config.js` - Configuration loader for Telegram downloader
- `constants.js` - Module constants
- `logger.js` - Logger utility with verbose mode support

### Download modules
- `download.js` - Main downloader class
- `download-index.js` - Download module index (exports all download functions)
- `download-links.js` - External links handling
- `download-media.js` - Media download functionality
- `download-message.js` - Message download functionality
- `download-utils.js` - Download utility functions

### Pinned sync modules
- `pinned.js` - Pinned message synchronization
- `markdown.js` - Markdown converter for Telegram messages
- `entity-converter.js` - Entity converter for Telegram messages
- `topics-config.js` - Configuration loader for topics

### Utility modules
- `parser.js` - Message parser
- `retry.js` - Retry utility with exponential backoff
- `statistics.js` - Download statistics tracker
- `scraper.js` - Web scraper for external pages
- `telegram-utils.js` - Shared Telegram utility functions

## Troubleshooting

### "Message not found" errors
Some referenced messages may have been deleted from Telegram. This is normal and the downloader will continue with available messages.

### Download timeouts
Large media files may timeout after all retry attempts. Text content is always preserved. Try increasing `timeoutMaxMs` in config.

### 2FA Issues
If SMS doesn't arrive, use Apple Passwords app to generate the 2FA code. The code may also appear in your Telegram app instead of SMS.

### Session expired
If you get authentication errors, delete the `session` field from `config/auth.yml` and run `npm run auth` again.

### Rate limiting
If you encounter rate limiting, increase `rateLimitDelayMs` in the download configuration.

### Pinned sync issues
- Ensure the markdown file exists at the path specified in `config/topics.yml`
- Check that you have permission to edit pinned messages in the topic
- Use `npm run pinned:debug` to see detailed information about the sync process
- Verify the topicId and pinnedId are correct in the configuration

### Configuration file migration
If you're upgrading from an older version:
1. The old `config/telegram.yml` has been split into multiple files
2. Copy your API credentials to `config/main.yml`
3. Move topic definitions to `config/topics.yml`
4. Move download settings to `config/download.yml`
5. Create `config/auth.yml` from `config/auth-example.yml`
