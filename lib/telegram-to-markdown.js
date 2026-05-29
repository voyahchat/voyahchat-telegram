/**
 * Telegram to Markdown converter
 * Converts Telegram JSON messages to markdown format for website content
 *
 * @module telegram-to-markdown
 */

/**
 * Convert Telegram message JSON to markdown format
 * @param {Object} message - Telegram message object from JSON
 * @param {Object} options - Conversion options
 * @param {boolean} options.includeMedia - Include media references in output (default: true)
 * @returns {string} Markdown formatted text
 */
function convertMessageToMarkdown(message, options = {}) {
    const { includeMedia = true } = options;

    if (!message) {
        return '';
    }

    const text = message.text || '';
    const entities = message.entities || [];
    const media = message.media || [];

    // Apply entities to text to create markdown
    let markdown = applyEntitiesToText(text, entities);

    // Add media references if requested
    if (includeMedia && media.length > 0) {
        const mediaMarkdown = convertMediaToMarkdown(media);
        if (mediaMarkdown) {
            markdown = markdown ? `${markdown}\n\n${mediaMarkdown}` : mediaMarkdown;
        }
    }

    return markdown;
}

/**
 * Apply Telegram entities to text to create markdown formatting
 * @param {string} text - Plain text from Telegram message
 * @param {Array} entities - Array of entity objects
 * @returns {string} Markdown formatted text
 */
function applyEntitiesToText(text, entities) {
    if (!text) {
        return '';
    }

    if (!entities || entities.length === 0) {
        return text;
    }

    // Sort entities by offset in reverse order to avoid offset issues
    const sortedEntities = [...entities].sort((a, b) => b.offset - a.offset);

    let result = text;

    for (const entity of sortedEntities) {
        const offset = entity.offset;
        const length = entity.length;
        const entityText = result.substring(offset, offset + length);

        // Normalize entity type
        const type = normalizeEntityType(entity);

        let replacement;
        switch (type) {
        case 'bold':
            replacement = `**${entityText}**`;
            break;
        case 'italic':
            replacement = `*${entityText}*`;
            break;
        case 'code':
            replacement = `\`${entityText}\``;
            break;
        case 'pre':
            replacement = `\`\`\`\n${entityText}\n\`\`\``;
            break;
        case 'text_link':
        case 'textLink': {
            const url = entity.url || '';
            replacement = `[${entityText}](${url})`;
            break;
        }
        case 'mention':
            replacement = `@${entityText}`;
            break;
        case 'url':
            // URLs are already in text, keep as is
            replacement = entityText;
            break;
        case 'strikethrough':
            replacement = `~~${entityText}~~`;
            break;
        case 'underline':
            replacement = `<u>${entityText}</u>`;
            break;
        case 'spoiler':
            replacement = `||${entityText}||`;
            break;
        default:
            // Unknown entity type, keep text as is
            replacement = entityText;
        }

        result = result.substring(0, offset) + replacement + result.substring(offset + length);
    }

    return result;
}

/**
 * Normalize entity type from various formats
 * @param {Object} entity - Entity object
 * @returns {string} Normalized type name
 */
function normalizeEntityType(entity) {
    // Handle className from gramJS
    if (entity.className) {
        const typeMap = {
            'MessageEntityBold': 'bold',
            'MessageEntityItalic': 'italic',
            'MessageEntityCode': 'code',
            'MessageEntityPre': 'pre',
            'MessageEntityTextUrl': 'text_link',
            'MessageEntityUrl': 'url',
            'MessageEntityMention': 'mention',
            'MessageEntityHashtag': 'hashtag',
            'MessageEntityBotCommand': 'bot_command',
            'MessageEntityEmail': 'email',
            'MessageEntityPhone': 'phone',
            'MessageEntityUnderline': 'underline',
            'MessageEntityStrike': 'strikethrough',
            'MessageEntitySpoiler': 'spoiler',
        };
        return typeMap[entity.className] || entity.className.replace('MessageEntity', '').toLowerCase();
    }

    // Handle type field from Bot API or custom format
    return entity.type || '';
}

/**
 * Convert media array to markdown format
 * @param {Array} media - Array of media objects
 * @returns {string} Markdown formatted media references
 */
function convertMediaToMarkdown(media) {
    if (!media || media.length === 0) {
        return '';
    }

    const mediaLines = media.map(item => {
        const type = item.type || 'file';
        const filename = item.filename || item.localPath || item.file || '';
        const caption = item.caption || '';

        switch (type) {
        case 'photo':
            return caption ? `![${caption}](${filename})` : `![](${filename})`;
        case 'video':
            return `[${filename}](${filename})`;
        case 'document':
            return `[${filename}](${filename})`;
        default:
            return `[${filename}](${filename})`;
        }
    });

    return mediaLines.join('\n');
}

module.exports = {
    convertMessageToMarkdown,
    applyEntitiesToText,
    convertMediaToMarkdown,
};
