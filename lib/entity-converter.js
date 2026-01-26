/**
 * Entity converter for Telegram messages
 * Converts between custom entity format and gramJS Api.MessageEntity types
 *
 * @module telegram/entity-converter
 */

const { Api } = require('telegram/tl');

/**
 * Convert custom entity format to gramJS Api.MessageEntity objects
 * @param {Array} entities - Array of custom entity objects with type, offset, length, url
 * @returns {Array} Array of Api.MessageEntity objects
 */
function toGramJS(entities) {
    if (!entities || entities.length === 0) {
        return [];
    }

    return entities.map(entity => {
        switch (entity.type) {
        case 'bold':
            return new Api.MessageEntityBold({
                offset: entity.offset,
                length: entity.length,
            });
        case 'text_link':
            return new Api.MessageEntityTextUrl({
                offset: entity.offset,
                length: entity.length,
                url: entity.url || '',
            });
        default:
            // Return null for unknown types, filter them out later
            return null;
        }
    }).filter(e => e !== null);
}

/**
 * Validate that entities can be converted to gramJS format
 * @param {Array} entities - Array of custom entity objects
 * @throws {Error} If any entity has invalid format
 */
function validate(entities) {
    if (!entities || entities.length === 0) {
        return;
    }

    for (const entity of entities) {
        if (typeof entity.offset !== 'number' || entity.offset < 0) {
            throw new Error(`Invalid entity offset: ${entity.offset}`);
        }
        if (typeof entity.length !== 'number' || entity.length <= 0) {
            throw new Error(`Invalid entity length: ${entity.length}`);
        }
        if (!['bold', 'text_link'].includes(entity.type)) {
            throw new Error(`Unknown entity type: ${entity.type}`);
        }
        if (entity.type === 'text_link' && typeof entity.url !== 'string') {
            throw new Error('text_link entity missing url');
        }
    }
}

module.exports = { toGramJS, validate };
