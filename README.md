# Telegram Integration

This module downloads messages from the VoyahChat Telegram group for publishing on the website.

## Setup

1. Create `config/auth-telegram.yml` with your credentials:
```yaml
api_id: YOUR_API_ID
api_hash: YOUR_API_HASH
phone: YOUR_PHONE_NUMBER
```

2. Get API credentials from https://my.telegram.org/apps

## Usage

### Authentication
```bash
npm run telegram:auth
```
- Enter the verification code when prompted
- If 2FA is enabled, enter your password (use Apple Passwords if configured)

### Download Messages

#### Download all sections (with resume capability)
```bash
npm run telegram:download
```
- Automatically resumes interrupted downloads
- Validates integrity of already downloaded sections
- Only downloads missing or corrupted files

#### Download specific section
```bash
npm run telegram:download -- --section=encars
```

### Check Authentication Status
```bash
npm run telegram:auth-status
```

## Features

- **Resume Capability**: Interrupted downloads can be resumed
- **Integrity Checking**: Validates downloaded files on each run
- **Media Downloads**: Automatically downloads images, videos, and documents
- **Timeout Handling**: Large files have configurable timeout with retries
- **Progress Tracking**: Saves progress after each section
- **Statistics**: Detailed download statistics and error tracking

## Output Structure

```
telegram/
├── index.json              # Master index with all sections
├── sections/
│   ├── encars/
│   │   ├── 748047.json     # Pinned message
│   │   ├── pinned.json     # Copy of pinned message
│   │   ├── metadata.json   # Section metadata
│   │   ├── referenced/     # Referenced messages
│   │   │   ├── 987434.json
│   │   │   └── ...
│   │   └── media/          # Downloaded media files
│   │       ├── 224702.mp4
│   │       └── ...
│   └── ...
└── additional/             # Additional standalone messages
    ├── metadata.json
    └── message-slug/
        └── 123456.json
```

## Configuration

### Main Configuration: config/telegram.yml

```yaml
chat: voyahchat

sections:
  - name: "Section Name"
    slug: "section-slug"
    topicId: 12345
    pinnedMessageId: 67890

  - name: "Entire Topic Section"
    slug: "topic-section"
    topicId: 11111
    # No pinnedMessageId - downloads entire topic

additionalMessages:
  - name: "Standalone Message"
    slug: "standalone"
    messageId: 99999
    downloadReplies: true
    replyToId: 88888

download:
  maxRetries: 10
  retryDelayBaseMs: 2000
  retryDelayMaxMs: 60000
  retryJitterMs: 1000
  timeoutBaseMs: 60000
  timeoutPerMbMs: 30000
  timeoutMaxMs: 600000
  connectionRetries: 5
  connectionTimeoutMs: 30000
  messagesPerRequest: 100
  rateLimitDelayMs: 1000
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

## Troubleshooting

### "Message not found" errors
Some referenced messages may have been deleted from Telegram. This is normal and the downloader will continue with available messages.

### Download timeouts
Large media files may timeout after all retry attempts. Text content is always preserved. Try increasing `timeoutMaxMs` in config.

### 2FA Issues
If SMS doesn't arrive, use Apple Passwords app to generate the 2FA code. The code may also appear in your Telegram app instead of SMS.

### Session expired
If you get authentication errors, delete the `session` field from `config/auth-telegram.yml` and run `npm run telegram:auth` again.

### Rate limiting
If you encounter rate limiting, increase `rateLimitDelayMs` in the download configuration.

## Module Structure

- `auth.js` - Authentication CLI script
- `config.js` - Configuration loader
- `constants.js` - Module constants
- `download.js` - Main downloader class
- `parser.js` - Message parser
- `retry.js` - Retry utility with exponential backoff
- `statistics.js` - Download statistics tracker
