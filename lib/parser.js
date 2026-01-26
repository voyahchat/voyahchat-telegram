/**
 * Telegram message parser
 * Extracts message IDs, parses URLs, and converts messages to JSON format
 *
 * @module telegram/parser
 */

/**
 * Parse t.me links from message text
 */
class TelegramParser {
    /**
     * Extract all t.me/chat/... URLs from message text
     * @param {string} text - Message text
     * @returns {number[]} Array of unique message IDs extracted from URLs
     */
    static extractReferencedMessages(text) {
        if (!text) return [];

        // Regex to match t.me/chat/topic/message or t.me/chat/message
        const regex = /https?:\/\/t\.me\/[a-zA-Z0-9_]+(?:\/(\d+))?\/(\d+)/g;
        const matches = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
            // match[1] is topicId (optional), match[2] is messageId
            const messageId = parseInt(match[2]);
            if (messageId && !matches.includes(messageId)) {
                matches.push(messageId);
            }
        }

        return matches;
    }

    /**
     * Extract message ID from t.me URL
     * @param {string} url - t.me URL
     * @returns {Object|null} Object with topicId and messageId, or null if URL is invalid
     */
    static parseUrl(url) {
        const regex = /https?:\/\/t\.me\/[a-zA-Z0-9_]+(?:\/(\d+))?\/(\d+)/;
        const match = url.match(regex);

        if (!match) return null;

        return {
            topicId: match[1] ? parseInt(match[1]) : null,
            messageId: parseInt(match[2]),
        };
    }

    /**
     * Check if text contains any t.me links
     * @param {string} text - Message text
     * @returns {boolean} True if text contains t.me links, false otherwise
     */
    static hasLinks(text) {
        if (!text) return false;
        return /https?:\/\/t\.me\/[a-zA-Z0-9_]+/.test(text);
    }

    /**
     * Parse Telegram message object to JSON format
     * @param {Object} message - Telegram message object
     * @returns {Object} Parsed message object
     */
    static parseMessage(message) {
        const json = {
            id: message.id,
            date: message.date ? (
                message.date instanceof Date ?
                    message.date.toISOString() :
                    new Date(message.date).toISOString()
            ) : new Date().toISOString(),
            text: message.message || '',
            entities: message.entities || [],
            media: [],
            referencedMessages: [],
        };

        // Extract referenced messages from text
        if (message.message) {
            json.referencedMessages = this.extractReferencedMessages(message.message);
        }

        return json;
    }
}

module.exports = { TelegramParser };
