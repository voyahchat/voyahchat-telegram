/**
 * Pinned message parser
 * Parses pinned message markdown files to extract structured link information
 *
 * @module pinned-parser
 */

const fs = require('fs');

/**
 * Parse pinned message file
 * @param {string} filePath - Path to the pinned message markdown file
 * @returns {Object} Parsed pinned message data
 */
function parsePinnedFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return parsePinnedContent(content);
}

/**
 * Parse pinned message content
 * @param {string} content - Markdown content from pinned message file
 * @returns {Object} Parsed data with title, updatedAt, and links
 */
function parsePinnedContent(content) {
    if (!content) {
        return { title: '', updatedAt: null, links: [] };
    }

    const lines = content.split('\n');
    const result = {
        title: '',
        updatedAt: null,
        links: [],
    };

    // Parse first line for title and date
    if (lines.length > 0) {
        const firstLine = lines[0];
        const titleMatch = firstLine.match(/\*\*([^*]+)\*\*/);
        if (titleMatch) {
            result.title = titleMatch[1];
        }

        const dateMatch = firstLine.match(/\(обновлено\s+([^)]+)\)/);
        if (dateMatch) {
            result.updatedAt = dateMatch[1];
        }
    }

    // Extract all links from content
    result.links = extractLinks(content);

    return result;
}

/**
 * Extract all links from markdown content
 * @param {string} content - Markdown content
 * @returns {Array} Array of link objects with text, url, and classification
 */
function extractLinks(content) {
    if (!content) {
        return [];
    }

    const links = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
        const text = match[1];
        const url = match[2];
        const classified = classifyLink(url);

        links.push({
            text,
            url,
            ...classified,
        });
    }

    return links;
}

/**
 * Classify a link by its URL
 * @param {string} url - URL to classify
 * @returns {Object} Classification result with type and extracted data
 */
function classifyLink(url) {
    if (!url) {
        return { type: 'unknown' };
    }

    // Check for Telegram message link
    const telegramMatch = url.match(/t\.me\/voyahchat\/(\d+)\/(\d+)/);
    if (telegramMatch) {
        return {
            type: 'telegram-message',
            topicId: parseInt(telegramMatch[1], 10),
            messageId: parseInt(telegramMatch[2], 10),
        };
    }

    // Check for site page link
    if (url.includes('voyahchat.ru/')) {
        const pathMatch = url.match(/voyahchat\.ru\/(.+)/);
        return {
            type: 'site-page',
            sitePath: pathMatch ? pathMatch[1] : '',
        };
    }

    // External link
    return {
        type: 'external-link',
    };
}

/**
 * Parse Telegram URL to extract topicId and messageId
 * @param {string} url - Telegram URL
 * @returns {Object|null} Object with topicId and messageId, or null if not a valid Telegram URL
 */
function parseTelegramUrl(url) {
    if (!url) {
        return null;
    }

    const match = url.match(/t\.me\/voyahchat\/(\d+)\/(\d+)/);
    if (!match) {
        return null;
    }

    return {
        topicId: parseInt(match[1], 10),
        messageId: parseInt(match[2], 10),
    };
}

module.exports = {
    parsePinnedFile,
    parsePinnedContent,
    extractLinks,
    classifyLink,
    parseTelegramUrl,
};
