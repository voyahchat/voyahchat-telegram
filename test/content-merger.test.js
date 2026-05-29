const test = require('ava');
const {
    mergeContent,
    addToIndex,
    extractSections,
    findSection,
    isDuplicate,
} = require('../lib/content-merger');

// Tests for mergeContent
test('mergeContent() - should return new content when existing is empty', (t) => {
    // Arrange
    const existingContent = '';
    const newContent = 'New content';

    // Act
    const result = mergeContent(existingContent, newContent);

    // Assert
    t.is(result, 'New content');
});

test('mergeContent() - should return existing content when new is empty', (t) => {
    // Arrange
    const existingContent = 'Existing content';
    const newContent = '';

    // Act
    const result = mergeContent(existingContent, newContent);

    // Assert
    t.is(result, 'Existing content');
});

test('mergeContent() - should append new content by default', (t) => {
    // Arrange
    const existingContent = 'Existing content';
    const newContent = 'New content';

    // Act
    const result = mergeContent(existingContent, newContent);

    // Assert
    t.is(result, 'Existing content\n\nNew content');
});

test('mergeContent() - should prepend new content when mode is prepend', (t) => {
    // Arrange
    const existingContent = 'Existing content';
    const newContent = 'New content';

    // Act
    const result = mergeContent(existingContent, newContent, { mode: 'prepend' });

    // Assert
    t.is(result, 'New content\n\nExisting content');
});

test('mergeContent() - should replace content when mode is replace', (t) => {
    // Arrange
    const existingContent = 'Existing content';
    const newContent = 'New content';

    // Act
    const result = mergeContent(existingContent, newContent, { mode: 'replace' });

    // Assert
    t.is(result, 'New content');
});

test('mergeContent() - should not add duplicate content by default', (t) => {
    // Arrange
    const existingContent = 'This is some content\n\nWith multiple lines';
    const newContent = 'This is some content';

    // Act
    const result = mergeContent(existingContent, newContent);

    // Assert
    t.is(result, existingContent);
});

test('mergeContent() - should add content when checkDuplicates is false', (t) => {
    // Arrange
    const existingContent = 'This is some content';
    const newContent = 'This is some content';

    // Act
    const result = mergeContent(existingContent, newContent, { checkDuplicates: false });

    // Assert
    t.is(result, 'This is some content\n\nThis is some content');
});

test('mergeContent() - should handle null existing content', (t) => {
    // Arrange
    const existingContent = null;
    const newContent = 'New content';

    // Act
    const result = mergeContent(existingContent, newContent);

    // Assert
    t.is(result, 'New content');
});

test('mergeContent() - should handle null new content', (t) => {
    // Arrange
    const existingContent = 'Existing content';
    const newContent = null;

    // Act
    const result = mergeContent(existingContent, newContent);

    // Assert
    t.is(result, 'Existing content');
});

// Tests for isDuplicate
test('isDuplicate() - should return false for empty existing content', (t) => {
    // Arrange
    const existingContent = '';
    const newContent = 'New content';

    // Act
    const result = isDuplicate(existingContent, newContent);

    // Assert
    t.is(result, false);
});

test('isDuplicate() - should return false for empty new content', (t) => {
    // Arrange
    const existingContent = 'Existing content';
    const newContent = '';

    // Act
    const result = isDuplicate(existingContent, newContent);

    // Assert
    t.is(result, false);
});

test('isDuplicate() - should return true when content is duplicate', (t) => {
    // Arrange
    const existingContent = 'This is some content\n\nWith multiple lines';
    const newContent = 'This is some content';

    // Act
    const result = isDuplicate(existingContent, newContent);

    // Assert
    t.is(result, true);
});

test('isDuplicate() - should return false when content is not duplicate', (t) => {
    // Arrange
    const existingContent = 'This is some content';
    const newContent = 'This is different content';

    // Act
    const result = isDuplicate(existingContent, newContent);

    // Assert
    t.is(result, false);
});

test('isDuplicate() - should normalize whitespace when comparing', (t) => {
    // Arrange
    const existingContent = 'This is some content\n\n\nWith extra newlines';
    const newContent = 'This is some content\n\nWith extra newlines';

    // Act
    const result = isDuplicate(existingContent, newContent);

    // Assert
    t.is(result, true);
});

// Tests for addToIndex
test('addToIndex() - should create new index when content is empty', (t) => {
    // Arrange
    const indexContent = '';
    const entry = { text: 'New Page', path: 'new-page.md' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [New Page](new-page.md)');
});

test('addToIndex() - should append entry to existing index', (t) => {
    // Arrange
    const indexContent = '- [Existing Page](existing.md)';
    const entry = { text: 'New Page', path: 'new-page.md' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [Existing Page](existing.md)\n- [New Page](new-page.md)');
});

test('addToIndex() - should not add duplicate entry', (t) => {
    // Arrange
    const indexContent = '- [Existing Page](existing.md)';
    const entry = { text: 'Existing Page', path: 'existing.md' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [Existing Page](existing.md)');
});

test('addToIndex() - should return existing content when entry is null', (t) => {
    // Arrange
    const indexContent = '- [Existing Page](existing.md)';
    const entry = null;

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [Existing Page](existing.md)');
});

test('addToIndex() - should return existing content when entry has no text', (t) => {
    // Arrange
    const indexContent = '- [Existing Page](existing.md)';
    const entry = { path: 'new-page.md' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [Existing Page](existing.md)');
});

test('addToIndex() - should return existing content when entry has no path', (t) => {
    // Arrange
    const indexContent = '- [Existing Page](existing.md)';
    const entry = { text: 'New Page' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [Existing Page](existing.md)');
});

test('addToIndex() - should add entry under specified section', (t) => {
    // Arrange
    const indexContent = `# Main Index

## Section One
- [Page 1](page1.md)

## Section Two
- [Page 2](page2.md)`;

    const entry = { text: 'New Page', path: 'new-page.md', section: 'Section One' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.true(result.includes('## Section One'));
    t.true(result.includes('- [New Page](new-page.md)'));
    t.true(result.indexOf('- [New Page](new-page.md)') < result.indexOf('## Section Two'));
});

test('addToIndex() - should append to end when section not found', (t) => {
    // Arrange
    const indexContent = '# Main Index\n- [Page 1](page1.md)';
    const entry = { text: 'New Page', path: 'new-page.md', section: 'Nonexistent Section' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.true(result.endsWith('- [New Page](new-page.md)'));
});

test('addToIndex() - should handle null index content', (t) => {
    // Arrange
    const indexContent = null;
    const entry = { text: 'New Page', path: 'new-page.md' };

    // Act
    const result = addToIndex(indexContent, entry);

    // Assert
    t.is(result, '- [New Page](new-page.md)');
});

// Tests for extractSections
test('extractSections() - should return empty array for null content', (t) => {
    // Arrange
    const content = null;

    // Act
    const result = extractSections(content);

    // Assert
    t.deepEqual(result, []);
});

test('extractSections() - should return empty array for empty content', (t) => {
    // Arrange
    const content = '';

    // Act
    const result = extractSections(content);

    // Assert
    t.deepEqual(result, []);
});

test('extractSections() - should extract single section', (t) => {
    // Arrange
    const content = '# Heading\nContent here';

    // Act
    const result = extractSections(content);

    // Assert
    t.is(result.length, 1);
    t.is(result[0].level, 1);
    t.is(result[0].heading, 'Heading');
    t.is(result[0].content, '# Heading\nContent here');
});

test('extractSections() - should extract multiple sections', (t) => {
    // Arrange
    const content = `# Section One
Content one

## Section Two
Content two`;

    // Act
    const result = extractSections(content);

    // Assert
    t.is(result.length, 2);
    t.is(result[0].heading, 'Section One');
    t.is(result[1].heading, 'Section Two');
});

test('extractSections() - should handle content before first heading', (t) => {
    // Arrange
    const content = `Intro text

# First Heading
Content`;

    // Act
    const result = extractSections(content);

    // Assert
    t.is(result.length, 2);
    t.is(result[0].level, 0);
    t.is(result[0].heading, '');
    t.is(result[1].heading, 'First Heading');
});

test('extractSections() - should handle different heading levels', (t) => {
    // Arrange
    const content = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;

    // Act
    const result = extractSections(content);

    // Assert
    t.is(result.length, 6);
    t.is(result[0].level, 1);
    t.is(result[1].level, 2);
    t.is(result[2].level, 3);
    t.is(result[3].level, 4);
    t.is(result[4].level, 5);
    t.is(result[5].level, 6);
});

// Tests for findSection
test('findSection() - should return null for null content', (t) => {
    // Arrange
    const content = null;
    const heading = 'Section';

    // Act
    const result = findSection(content, heading);

    // Assert
    t.is(result, null);
});

test('findSection() - should return null when section not found', (t) => {
    // Arrange
    const content = '# Section One\nContent';
    const heading = 'Section Two';

    // Act
    const result = findSection(content, heading);

    // Assert
    t.is(result, null);
});

test('findSection() - should find section by heading', (t) => {
    // Arrange
    const content = `# Section One
Content one

# Section Two
Content two`;

    const heading = 'Section Two';

    // Act
    const result = findSection(content, heading);

    // Assert
    t.is(result.heading, 'Section Two');
    t.true(result.content.includes('Content two'));
});

test('findSection() - should find first matching section', (t) => {
    // Arrange
    const content = `# Section
Content one

# Section
Content two`;

    const heading = 'Section';

    // Act
    const result = findSection(content, heading);

    // Assert
    t.true(result.content.includes('Content one'));
});
