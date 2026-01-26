const test = require('ava');
const { DownloadStatistics, SectionDownloadStatistics } = require('../lib/statistics');

test('DownloadStatistics.incrementMessages() - should increment message count', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act
    stats.incrementMessages('total', 5);
    stats.incrementMessages('downloaded', 3);
    stats.incrementMessages('skipped', 1);
    stats.incrementMessages('failed', 1);

    // Assert
    t.is(stats.messages.total, 5);
    t.is(stats.messages.downloaded, 3);
    t.is(stats.messages.skipped, 1);
    t.is(stats.messages.failed, 1);
});

test('DownloadStatistics.incrementMedia() - should increment media count and size', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act
    stats.incrementMedia('total', 1024 * 1024);
    stats.incrementMedia('downloaded', 512 * 1024);

    // Assert
    t.is(stats.media.total, 1);
    t.is(stats.media.downloaded, 1);
    t.is(stats.media.totalSize, 1024 * 1024);
    t.is(stats.media.downloadedSize, 512 * 1024);
});

test('DownloadStatistics.addError() - should add error to list', (t) => {
    // Arrange
    const stats = new DownloadStatistics();
    const error = new Error('Test error');

    // Act
    stats.addError(error, 'download', { messageId: 123 });

    // Assert
    t.is(stats.errors.length, 1);
    t.is(stats.errors[0].message, 'Test error');
    t.is(stats.errors[0].context, 'download');
    t.is(stats.errors[0].metadata.messageId, 123);
});

test('DownloadStatistics.addError() - should limit errors to 100', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act
    for (let i = 0; i < 150; i++) {
        stats.addError(new Error(`Error ${i}`), 'test');
    }

    // Assert
    t.is(stats.errors.length, 100);
    t.is(stats.errors[0].message, 'Error 50');
    t.is(stats.errors[99].message, 'Error 149');
});

test('DownloadStatistics.addRetry() - should track retry statistics', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act
    stats.addRetry('download', 3);
    stats.addRetry('download', 2);
    stats.addRetry('media', 4);

    // Assert
    t.is(stats.retries.total, 6); // (3-1) + (2-1) + (4-1)
    t.is(stats.retries.byType.get('download').count, 2);
    t.is(stats.retries.byType.get('download').totalAttempts, 5);
    t.is(stats.retries.byType.get('media').count, 1);
    t.is(stats.retries.byType.get('media').totalAttempts, 4);
});

test('DownloadStatistics.addTimeout() - should track timeout statistics', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act
    stats.addTimeout(500 * 1024, 30000); // < 1MB
    stats.addTimeout(5 * 1024 * 1024, 60000); // 1-10MB
    stats.addTimeout(50 * 1024 * 1024, 120000); // 50MB -> 50-100MB

    // Assert
    t.is(stats.timeouts.total, 3);
    t.is(stats.timeouts.bySize.get('< 1MB').count, 1);
    t.is(stats.timeouts.bySize.get('1-10MB').count, 1);
    t.is(stats.timeouts.bySize.get('50-100MB').count, 1);
});

test('DownloadStatistics.getSizeRange() - should categorize sizes correctly', (t) => {
    // Arrange
    const stats = new DownloadStatistics();
    const testCases = [
        { size: 500 * 1024, expected: '< 1MB' },
        { size: 5 * 1024 * 1024, expected: '1-10MB' },
        { size: 30 * 1024 * 1024, expected: '10-50MB' },
        { size: 75 * 1024 * 1024, expected: '50-100MB' },
        { size: 150 * 1024 * 1024, expected: '> 100MB' },
    ];

    // Act & Assert
    for (const testCase of testCases) {
        const result = stats.getSizeRange(testCase.size);
        t.is(result, testCase.expected);
    }
});

test('DownloadStatistics.getDuration() - should calculate duration', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act & Assert - Initial state
    t.is(stats.getDuration(), 0);

    // Act
    stats.start();
    // Simulate some time passing
    stats.startTime = new Date(Date.now() - 5000);
    stats.stop();
    const duration = stats.getDuration();

    // Assert
    t.true(duration >= 4900 && duration <= 5100);
});

test('DownloadStatistics.getSuccessRate() - should calculate success rate', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act & Assert - Initial state
    t.is(stats.getSuccessRate(), 0);

    // Act
    stats.incrementMessages('total', 10);
    stats.incrementMessages('downloaded', 8);
    const result = stats.getSuccessRate();

    // Assert
    t.is(result, 80);
});

test('DownloadStatistics.getMediaSuccessRate() - should calculate media success rate', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act & Assert - Initial state
    t.is(stats.getMediaSuccessRate(), 0);

    // Act
    stats.incrementMedia('total', 1024);
    stats.incrementMedia('total', 1024);
    stats.incrementMedia('total', 1024);
    stats.incrementMedia('total', 1024);
    stats.incrementMedia('downloaded', 512);
    stats.incrementMedia('downloaded', 512);
    stats.incrementMedia('downloaded', 512);
    const result = stats.getMediaSuccessRate();

    // Assert
    t.is(result, 75);
});

test('DownloadStatistics.getAverageRetries() - should calculate average retries', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act & Assert - Initial state
    t.is(stats.getAverageRetries(), 0);

    // Act
    stats.addRetry('download', 3); // 2 retries
    stats.addRetry('download', 5); // 4 retries
    // Total: 6 retries, 2 operations, average = 3
    const avg = stats.getAverageRetries();

    // Assert
    t.is(avg, 3);
});

test('DownloadStatistics.getStatistics() - should return formatted stats', (t) => {
    // Arrange
    const stats = new DownloadStatistics();
    stats.start();
    stats.incrementMessages('total', 10);
    stats.incrementMessages('downloaded', 8);
    stats.incrementMedia('total', 1024 * 1024);
    stats.incrementMedia('downloaded', 512 * 1024);
    stats.stop();

    // Act
    const result = stats.getStatistics();

    // Assert
    t.is(typeof result.duration, 'object');
    t.is(result.duration.start, stats.startTime.toISOString());
    t.is(result.messages.total, 10);
    t.is(result.messages.downloaded, 8);
    t.is(result.messages.successRate, 80);
    t.is(result.media.total, 1);
    t.is(result.sections.total, 0);
});

test('DownloadStatistics.reset() - should clear all statistics', (t) => {
    // Arrange
    const stats = new DownloadStatistics();
    stats.start();
    stats.incrementMessages('total', 10);
    stats.addError(new Error('test'), 'test');

    // Act
    stats.reset();

    // Assert
    t.is(stats.startTime, null);
    t.is(stats.messages.total, 0);
    t.is(stats.errors.length, 0);
});

test('DownloadStatistics.addSection() - should add section statistics', (t) => {
    // Arrange
    const stats = new DownloadStatistics();

    // Act
    stats.addSection('test-section', {
        messageCount: 10,
        mediaCount: 5,
    });

    // Assert
    t.is(stats.sections.size, 1);
    t.is(stats.sections.get('test-section').messageCount, 10);
});

// SectionDownloadStatistics tests
test('SectionDownloadStatistics.constructor() - should initialize with default values', (t) => {
    // Arrange & Act
    const stats = new SectionDownloadStatistics('test-section');

    // Assert
    t.is(stats.sectionName, 'test-section');
    t.is(stats.messages.cached, 0);
    t.is(stats.messages.new, 0);
    t.is(stats.messages.missed, 0);
    t.is(stats.links, 0);
    t.is(stats.bytes.cached, 0);
    t.is(stats.bytes.new, 0);
});

test('SectionDownloadStatistics.addCachedMessage() - should increment cached message count', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addCachedMessage(1024);
    const result1 = { messages: stats.messages.cached, bytes: stats.bytes.cached };

    stats.addCachedMessage(2048);
    const result2 = { messages: stats.messages.cached, bytes: stats.bytes.cached };

    // Assert
    t.is(result1.messages, 1);
    t.is(result1.bytes, 1024);
    t.is(result2.messages, 2);
    t.is(result2.bytes, 3072);
});

test('SectionDownloadStatistics.addNewMessage() - should increment new message count', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addNewMessage(1024);
    const result1 = { messages: stats.messages.new, bytes: stats.bytes.new };

    stats.addNewMessage(2048);
    const result2 = { messages: stats.messages.new, bytes: stats.bytes.new };

    // Assert
    t.is(result1.messages, 1);
    t.is(result1.bytes, 1024);
    t.is(result2.messages, 2);
    t.is(result2.bytes, 3072);
});

test('SectionDownloadStatistics.addMissedMessage() - should increment missed message count', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addMissedMessage();
    const result1 = stats.messages.missed;

    stats.addMissedMessage();
    const result2 = stats.messages.missed;

    // Assert
    t.is(result1, 1);
    t.is(result2, 2);
});

test('SectionDownloadStatistics.addLinks() - should increment links count', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addLinks();
    const result1 = stats.links;

    stats.addLinks(3);
    const result2 = stats.links;

    // Assert
    t.is(result1, 1);
    t.is(result2, 4);
});

test('SectionDownloadStatistics.getTotalMessages() - should return total message count', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addCachedMessage();
    stats.addNewMessage();
    stats.addNewMessage();
    const result = stats.getTotalMessages();

    // Assert
    t.is(result, 3);
});

test('SectionDownloadStatistics.getTotalBytes() - should return total bytes', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addCachedMessage(1024);
    stats.addNewMessage(2048);
    const result = stats.getTotalBytes();

    // Assert
    t.is(result, 3072);
});

test('SectionDownloadStatistics.format() - should return formatted statistics', (t) => {
    // Arrange
    const stats = new SectionDownloadStatistics('test-section');

    // Act
    stats.addCachedMessage(1024);
    stats.addNewMessage(2048);
    stats.addLinks(5);
    stats.addMissedMessage();
    const formatted = stats.format();

    // Assert
    t.true(formatted.includes('2 messages'));
    t.true(formatted.includes('1 cached'));
    t.true(formatted.includes('1 new'));
    t.true(formatted.includes('5 links'));
    t.true(formatted.includes('0.0Mb'));
    t.true(formatted.includes('1 missed'));
});
