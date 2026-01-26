/**
 * Markdown converter for Telegram messages
 * Converts between markdown format and Telegram's text with entities format
 *
 * @module telegram/markdown
 */

/**
 * Convert between markdown and Telegram message formats
 */
class MarkdownConverter {
    /**
     * Convert markdown to Telegram format (text with entities)
     * @param {string} markdown - Markdown text to convert
     * @returns {Object} Object with text and entities properties
     */
    static toTelegram(markdown) {
        if (!markdown) {
            return { text: '', entities: [] };
        }

        // Collect all matches with their original positions
        const matches = [];

        // Find all bold patterns in original text
        const boldRegex = /\*\*([^*]+)\*\*/g;
        let match;
        while ((match = boldRegex.exec(markdown)) !== null) {
            matches.push({
                type: 'bold',
                start: match.index,
                end: match.index + match[0].length,
                text: match[1],
                url: null,
            });
        }

        // Find all link patterns in original text
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        while ((match = linkRegex.exec(markdown)) !== null) {
            matches.push({
                type: 'text_link',
                start: match.index,
                end: match.index + match[0].length,
                text: match[1],
                url: match[2],
            });
        }

        // Sort by start position
        matches.sort((a, b) => a.start - b.start);

        // Build final text and calculate correct offsets
        let finalText = '';
        let lastEnd = 0;
        const entities = [];

        for (const m of matches) {
            // Add text before this match (unchanged text from original)
            finalText += markdown.substring(lastEnd, m.start);

            // Calculate correct offset in final text
            const finalOffset = finalText.length;

            // Create entity with correct offset
            const entity = {
                type: m.type,
                offset: finalOffset,
                length: m.text.length,
            };

            // Add URL for text_link entities
            if (m.url) {
                entity.url = m.url;
            }

            entities.push(entity);

            // Add the extracted text (without markdown syntax)
            finalText += m.text;

            // Update tracking position
            lastEnd = m.end;
        }

        // Add remaining text after last match
        finalText += markdown.substring(lastEnd);

        return { text: finalText, entities };
    }

    /**
     * Convert Telegram message (text with entities) back to markdown
     * @param {string} text - Plain text from Telegram
     * @param {Array} entities - Array of Telegram entities
     * @returns {string} Markdown formatted text
     */
    static fromTelegram(text, entities = []) {
        if (!text) {
            return '';
        }

        if (!entities || entities.length === 0) {
            return text;
        }

        // Create a copy of entities and sort by offset in reverse order
        const sortedEntities = [...entities].sort((a, b) => b.offset - a.offset);

        let markdown = text;

        // Apply entities from end to beginning to avoid offset issues
        for (const entity of sortedEntities) {
            const { type, offset, length } = entity;
            const entityText = markdown.substring(offset, offset + length);

            switch (type) {
            case 'bold':
                markdown = markdown.substring(0, offset) +
                    `**${entityText}**` +
                    markdown.substring(offset + length);
                break;
            case 'text_link': {
                const url = entity.url || '';
                markdown = markdown.substring(0, offset) +
                    `[${entityText}](${url})` +
                    markdown.substring(offset + length);
                break;
            }
            // Other entity types could be added here as needed
            }
        }

        return markdown;
    }

    /**
     * Compare two markdown strings for content equality
     * @param {string} md1 - First markdown string
     * @param {string} md2 - Second markdown string
     * @returns {boolean} True if content is equal, false otherwise
     */
    static compare(md1, md2) {
        if (!md1 && !md2) {
            return true;
        }

        if (!md1 || !md2) {
            return false;
        }

        // Convert both to Telegram format and compare
        const telegram1 = this.toTelegram(md1);
        const telegram2 = this.toTelegram(md2);

        // Compare text
        if (telegram1.text !== telegram2.text) {
            return false;
        }

        // Compare entities
        if (telegram1.entities.length !== telegram2.entities.length) {
            return false;
        }

        // Sort entities by offset for consistent comparison
        const sortedEntities1 = [...telegram1.entities].sort((a, b) => a.offset - b.offset);
        const sortedEntities2 = [...telegram2.entities].sort((a, b) => a.offset - b.offset);

        for (let i = 0; i < sortedEntities1.length; i++) {
            const entity1 = sortedEntities1[i];
            const entity2 = sortedEntities2[i];

            if (entity1.type !== entity2.type ||
                entity1.offset !== entity2.offset ||
                entity1.length !== entity2.length) {
                return false;
            }

            // For text_link entities, also compare URL
            if (entity1.type === 'text_link' && entity2.type === 'text_link') {
                if (entity1.url !== entity2.url) {
                    return false;
                }
            }
        }

        return true;
    }
}

module.exports = { MarkdownConverter };

