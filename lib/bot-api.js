/**
 * Telegram Bot API wrapper
 * Minimal HTTP client for Bot API using native fetch
 *
 * @module telegram/bot-api
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Telegram Bot API client
 */
class BotApi {
    /**
     * Create a new BotApi instance
     * @param {string} token - Bot token from BotFather
     * @param {Object} [options={}] - Options
     * @param {number} [options.requestTimeout=30000] - Request timeout in ms
     */
    constructor(token, options = {}) {
        if (!token || typeof token !== 'string') {
            throw new Error('Bot token is required');
        }
        this.token = token;
        this.baseUrl = `https://api.telegram.org/bot${token}`;
        this.requestTimeout = options.requestTimeout || 30000;
    }

    /**
     * Make a request to Bot API
     * @param {string} method - API method name
     * @param {Object} [params={}] - Request parameters
     * @returns {Promise<Object>} API response result
     * @throws {Error} If API returns an error
     */
    async request(method, params = {}) {
        const url = `${this.baseUrl}/${method}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal: controller.signal,
            });

            const data = await response.json();

            if (!data.ok) {
                const err = new Error(`Bot API error: ${data.description || 'Unknown error'}`);
                err.errorCode = data.error_code;
                err.description = data.description;
                throw err;
            }

            return data.result;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Make a multipart/form-data request (for file uploads)
     * @param {string} method - API method name
     * @param {FormData} formData - Form data with file
     * @returns {Promise<Object>} API response result
     * @throws {Error} If API returns an error
     */
    async requestFormData(method, formData) {
        const url = `${this.baseUrl}/${method}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });

            const data = await response.json();

            if (!data.ok) {
                const err = new Error(`Bot API error: ${data.description || 'Unknown error'}`);
                err.errorCode = data.error_code;
                err.description = data.description;
                throw err;
            }

            return data.result;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Get bot info to verify token is valid
     * @returns {Promise<Object>} Bot user object
     */
    async getMe() {
        return this.request('getMe');
    }

    /**
     * Send a text message
     * @param {Object} params - Message parameters
     * @param {string|number} params.chatId - Chat ID
     * @param {string} params.text - Message text
     * @param {Array} [params.entities] - Message entities
     * @param {number} [params.messageThreadId] - Forum topic ID
     * @param {boolean} [params.disableWebPagePreview=true] - Disable link preview
     * @param {string} [params.parseMode] - Parse mode (e.g., 'HTML', 'Markdown')
     * @returns {Promise<Object>} Sent message object
     */
    async sendMessage({ chatId, text, entities, messageThreadId, disableWebPagePreview = true, parseMode }) {
        const params = {
            chat_id: chatId,
            text,
            disable_web_page_preview: disableWebPagePreview,
        };

        if (parseMode) {
            params.parse_mode = parseMode;
        }

        if (entities && entities.length > 0) {
            params.entities = entities;
        }

        if (messageThreadId) {
            params.message_thread_id = messageThreadId;
        }

        return this.request('sendMessage', params);
    }

    /**
     * Edit a text message
     * @param {Object} params - Edit parameters
     * @param {string|number} params.chatId - Chat ID
     * @param {number} params.messageId - Message ID to edit
     * @param {string} params.text - New text
     * @param {Array} [params.entities] - New entities
     * @param {boolean} [params.disableWebPagePreview=true] - Disable link preview
     * @param {string} [params.parseMode] - Parse mode (e.g., 'HTML', 'Markdown')
     * @returns {Promise<Object>} Edited message object
     */
    async editMessageText({ chatId, messageId, text, entities, disableWebPagePreview = true, parseMode }) {
        const params = {
            chat_id: chatId,
            message_id: messageId,
            text,
            disable_web_page_preview: disableWebPagePreview,
        };

        if (parseMode) {
            params.parse_mode = parseMode;
        }

        if (entities && entities.length > 0) {
            params.entities = entities;
        }

        return this.request('editMessageText', params);
    }

    /**
     * Send a photo with caption
     * @param {Object} params - Photo parameters
     * @param {string|number} params.chatId - Chat ID
     * @param {string} params.photoPath - Absolute path to photo file
     * @param {string} [params.caption] - Photo caption
     * @param {Array} [params.captionEntities] - Caption entities
     * @param {number} [params.messageThreadId] - Forum topic ID
     * @param {string} [params.parseMode] - Parse mode for caption (e.g., 'HTML', 'Markdown')
     * @returns {Promise<Object>} Sent message object
     */
    async sendPhoto({ chatId, photoPath, caption, captionEntities, messageThreadId, parseMode }) {
        const formData = new FormData();
        formData.append('chat_id', String(chatId));

        // Read file and create Blob
        const fileData = await fs.readFile(photoPath);
        const fileName = path.basename(photoPath);
        const blob = new Blob([fileData]);
        formData.append('photo', blob, fileName);

        if (caption) {
            formData.append('caption', caption);
        }

        if (parseMode) {
            formData.append('parse_mode', parseMode);
        }

        if (captionEntities && captionEntities.length > 0) {
            formData.append('caption_entities', JSON.stringify(captionEntities));
        }

        if (messageThreadId) {
            formData.append('message_thread_id', String(messageThreadId));
        }

        return this.requestFormData('sendPhoto', formData);
    }

    /**
     * Edit a message's media (photo) and caption
     * @param {Object} params - Edit parameters
     * @param {string|number} params.chatId - Chat ID
     * @param {number} params.messageId - Message ID to edit
     * @param {string} params.photoPath - Absolute path to new photo file
     * @param {string} [params.caption] - New caption
     * @param {Array} [params.captionEntities] - New caption entities
     * @param {string} [params.parseMode] - Parse mode for caption (e.g., 'HTML', 'Markdown')
     * @returns {Promise<Object>} Edited message object
     */
    async editMessageMedia({ chatId, messageId, photoPath, caption, captionEntities, parseMode }) {
        const formData = new FormData();
        formData.append('chat_id', String(chatId));
        formData.append('message_id', String(messageId));

        // Read file and create Blob
        const fileData = await fs.readFile(photoPath);
        const fileName = path.basename(photoPath);
        const blob = new Blob([fileData]);
        formData.append('photo', blob, fileName);

        // Build media object referencing the attached file
        const media = {
            type: 'photo',
            media: 'attach://photo',
        };

        if (caption) {
            media.caption = caption;
        }

        if (parseMode) {
            media.parse_mode = parseMode;
        }

        if (captionEntities && captionEntities.length > 0) {
            media.caption_entities = captionEntities;
        }

        formData.append('media', JSON.stringify(media));

        return this.requestFormData('editMessageMedia', formData);
    }

    /**
     * Pin a message in chat
     * @param {Object} params - Pin parameters
     * @param {string|number} params.chatId - Chat ID
     * @param {number} params.messageId - Message ID to pin
     * @param {boolean} [params.disableNotification=true] - Disable notification
     * @returns {Promise<boolean>} True on success
     */
    async pinChatMessage({ chatId, messageId, disableNotification = true }) {
        return this.request('pinChatMessage', {
            chat_id: chatId,
            message_id: messageId,
            disable_notification: disableNotification,
        });
    }

    /**
     * Delete a message
     * @param {Object} params - Delete parameters
     * @param {string|number} params.chatId - Chat ID
     * @param {number} params.messageId - Message ID to delete
     * @returns {Promise<boolean>} True on success
     */
    async deleteMessage({ chatId, messageId }) {
        return this.request('deleteMessage', {
            chat_id: chatId,
            message_id: messageId,
        });
    }

    /**
     * Check if error is "message is not modified"
     * @param {Error} err - Error to check
     * @returns {boolean} True if message was not modified
     */
    static isMessageNotModified(err) {
        return !!(err && err.description &&
            err.description.includes('message is not modified'));
    }

    /**
     * Check if error is "message to edit not found"
     * @param {Error} err - Error to check
     * @returns {boolean} True if message was not found
     */
    static isMessageNotFound(err) {
        return !!(err && err.description &&
            (err.description.includes('message to edit not found') ||
             err.description.includes('message not found') ||
             err.description.includes('MESSAGE_ID_INVALID')));
    }
}

module.exports = { BotApi };
