/**
 * FAQ pinned message generator
 * Generates FAQ markdown with links to all other topics' pinned messages
 *
 * @module faq-generator
 */

const HEADER = 'Закрепы разделов, если они у вас пропали в Телеграме';

/**
 * Generate FAQ markdown content from topics configuration
 * @param {Object} config - Loaded topics configuration
 * @returns {string} Generated markdown content
 */
function generateFaqContent(config) {
    const faqTopic = config.topics.find(t => t.slug === 'faq');
    if (!faqTopic || !faqTopic.sections) {
        throw new Error('FAQ topic not found or has no sections');
    }

    const lines = [HEADER, ''];

    for (const section of faqTopic.sections) {
        for (const slug of section) {
            const topic = config.topics.find(t => t.slug === slug);
            if (!topic) {
                continue;
            }

            const url = topic.botPinnedId
                ? `https://t.me/voyahchat/${topic.topicId}/${topic.botPinnedId}`
                : `https://t.me/voyahchat/${topic.topicId}`;
            lines.push(`[${topic.title}](${url})`);
        }
        lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
}

/**
 * Generate FAQ content and save to file
 * @param {import('./topics-config').TopicsConfig} topicsConfig - Topics config instance
 * @returns {Promise<string>} Generated content
 */
async function generateAndSaveFaq(topicsConfig) {
    const config = await topicsConfig.load();
    const content = generateFaqContent(config);

    const faqTopic = config.topics.find(t => t.slug === 'faq');
    await topicsConfig.writePinnedFile(faqTopic.pinned, content);

    return content;
}

module.exports = { generateFaqContent, generateAndSaveFaq };
