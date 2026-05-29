/**
 * Content merger for markdown files
 * Intelligently merges new content into existing markdown files without duplication
 *
 * @module content-merger
 */

/**
 * Merge new content into existing markdown
 * @param {string} existingContent - Existing markdown content
 * @param {string} newContent - New content to merge
 * @param {Object} options - Merge options
 * @param {string} options.mode - Merge mode: 'append' (default), 'prepend', 'replace'
 * @param {boolean} options.checkDuplicates - Check for duplicate content (default: true)
 * @returns {string} Merged markdown content
 */
function mergeContent(existingContent, newContent, options = {}) {
    const {
        mode = 'append',
        checkDuplicates = true,
    } = options;

    if (!newContent) {
        return existingContent || '';
    }

    if (!existingContent) {
        return newContent;
    }

    // Check for duplicates if enabled
    if (checkDuplicates && isDuplicate(existingContent, newContent)) {
        return existingContent;
    }

    // Merge based on mode
    switch (mode) {
    case 'prepend':
        return `${newContent}\n\n${existingContent}`;
    case 'replace':
        return newContent;
    case 'append':
    default:
        return `${existingContent}\n\n${newContent}`;
    }
}

/**
 * Check if content is already present in existing content
 * @param {string} existingContent - Existing content
 * @param {string} newContent - New content to check
 * @returns {boolean} True if content is duplicate
 */
function isDuplicate(existingContent, newContent) {
    if (!existingContent || !newContent) {
        return false;
    }

    // Normalize whitespace for comparison
    const normalizedExisting = normalizeWhitespace(existingContent);
    const normalizedNew = normalizeWhitespace(newContent);

    return normalizedExisting.includes(normalizedNew);
}

/**
 * Normalize whitespace in content for comparison
 * @param {string} content - Content to normalize
 * @returns {string} Normalized content
 */
function normalizeWhitespace(content) {
    return content
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Add entry to index markdown file
 * @param {string} indexContent - Existing index.md content
 * @param {Object} entry - Entry to add
 * @param {string} entry.text - Link text
 * @param {string} entry.path - Link path
 * @param {string} entry.section - Optional section heading to add under
 * @returns {string} Updated index content
 */
function addToIndex(indexContent, entry) {
    if (!entry || !entry.text || !entry.path) {
        return indexContent || '';
    }

    const linkLine = `- [${entry.text}](${entry.path})`;

    // If no existing content, create new index
    if (!indexContent) {
        return linkLine;
    }

    // Check if link already exists
    if (indexContent.includes(linkLine)) {
        return indexContent;
    }

    // If section is specified, try to add under that section
    if (entry.section) {
        const sectionRegex = new RegExp(`^#{1,6}\\s+${entry.section}\\s*$`, 'mi');
        const match = indexContent.match(sectionRegex);

        if (match) {
            const sectionIndex = indexContent.indexOf(match[0]);
            const afterSection = indexContent.substring(sectionIndex + match[0].length);
            const nextSectionMatch = afterSection.match(/^#{1,6}\s+/m);

            if (nextSectionMatch) {
                // Insert before next section
                const insertIndex = sectionIndex + match[0].length + afterSection.indexOf(nextSectionMatch[0]);
                return indexContent.substring(0, insertIndex) +
                    `\n${linkLine}\n` +
                    indexContent.substring(insertIndex);
            } else {
                // Append to end of section
                return indexContent + `\n${linkLine}`;
            }
        }
    }

    // Default: append to end
    return `${indexContent}\n${linkLine}`;
}

/**
 * Extract sections from markdown content
 * @param {string} content - Markdown content
 * @returns {Array} Array of section objects with heading and content
 */
function extractSections(content) {
    if (!content) {
        return [];
    }

    const sections = [];
    const lines = content.split('\n');
    let currentSection = null;
    let beforeFirstHeading = [];

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

        if (headingMatch) {
            // Save content before first heading if exists
            if (beforeFirstHeading.length > 0 && !currentSection) {
                sections.push({
                    level: 0,
                    heading: '',
                    content: beforeFirstHeading.join('\n'),
                });
                beforeFirstHeading = [];
            }

            // Save previous section if exists
            if (currentSection) {
                sections.push(currentSection);
            }

            // Start new section
            currentSection = {
                level: headingMatch[1].length,
                heading: headingMatch[2],
                content: line,
            };
        } else if (currentSection) {
            // Add line to current section
            currentSection.content += '\n' + line;
        } else {
            // Content before first heading
            beforeFirstHeading.push(line);
        }
    }

    // Add content before first heading if no sections were found
    if (beforeFirstHeading.length > 0 && !currentSection) {
        sections.push({
            level: 0,
            heading: '',
            content: beforeFirstHeading.join('\n'),
        });
    }

    // Add last section
    if (currentSection) {
        sections.push(currentSection);
    }

    return sections;
}

/**
 * Find section by heading
 * @param {string} content - Markdown content
 * @param {string} heading - Section heading to find
 * @returns {Object|null} Section object or null if not found
 */
function findSection(content, heading) {
    const sections = extractSections(content);
    return sections.find(s => s.heading === heading) || null;
}

module.exports = {
    mergeContent,
    addToIndex,
    extractSections,
    findSection,
    isDuplicate,
};
