#!/usr/bin/env node

/**
 * Telegram authentication CLI
 * Handles authentication status checking and login flow
 *
 * @module telegram/auth
 */

const TelegramDownloader = require('./download');
const { TelegramLogger } = require('./logger');

// Create a logger instance
const logger = new TelegramLogger();

/**
 * Check authentication status
 */
async function checkAuthStatus() {
    logger.info('Telegram Authentication Status Check');
    logger.info('====================================');

    // Check if session exists in config
    try {
        const { TelegramConfig } = require('./config');
        const config = new TelegramConfig();
        const authConfig = await config.loadAuthConfig();
        const sessionExists = !!(authConfig && authConfig.session);
        logger.info(`\nSession exists: ${sessionExists ? '✓ Yes' : '✗ No'}`);

        // Display configuration
        logger.info('\nConfiguration:');
        logger.info(`  Phone: ${authConfig.phone}`);
        if (authConfig.email) {
            logger.info(`  Email: ${authConfig.email}`);
        }

        // Try to get API credentials from telegram config
        try {
            const telegramConfig = await config.loadTelegramConfig();
            logger.info(`  API ID: ${telegramConfig.api_id}`);
        } catch (telegramErr) {
            logger.info('  API ID: ✗ Not configured');
        }

        // Provide recommendations
        logger.info('\nRecommendations:');

        if (!sessionExists) {
            logger.info('\n1. First-time authentication:');
            logger.info('   - Try: npm run auth');
            logger.info('   - If SMS doesn\'t arrive, check your Telegram app for the code');
            logger.info('   - The code might appear in Telegram Desktop/Mobile instead of SMS');

            logger.info('\n2. If SMS is blocked:');
            logger.info('   - Use VPN (US/Europe) and try again');
            logger.info('   - Wait 1-2 hours for Telegram to unblock your number');
            logger.info('   - The session will be saved to config/auth.yml');
        } else {
            logger.info('\n✓ Session exists - you can download messages:');
            logger.info('   - Download all: npm run download');
            logger.info('   - Download specific: npm run download -- --section=encars');
        }
    } catch (err) {
        logger.info('\n✗ Configuration file not found or invalid');
        logger.info('  Please create config/auth.yml with your phone number');
        logger.info('  Get API credentials from https://my.telegram.org/apps');
        logger.info('  API credentials should be in config/main.yml');
        logger.info('  Chat configuration should be in config/download.yml');
    }

    logger.info('\nTroubleshooting:');
    logger.info('- If you have 2FA enabled, have your password ready (from Apple Passwords)');
    logger.info('- Make sure Telegram Desktop/Mobile is installed - codes appear there too');
}

/**
 * Authenticate with Telegram
 */
async function auth() {
    const downloader = new TelegramDownloader();

    try {
        logger.info('Initializing Telegram client...');
        logger.info('Reading auth config...');
        const { TelegramConfig } = require('./config');
        const config = new TelegramConfig();
        const authConfig = await config.loadAuthConfig();
        const telegramConfig = await config.loadTelegramConfig();
        logger.info(`Phone: ${authConfig.phone}`);
        logger.info(`API ID: ${telegramConfig.api_id}`);

        await downloader.init();
        logger.info('Authentication successful!');
        logger.info('Session saved to config/auth.yml');
        await downloader.close();
    } catch (err) {
        logger.error('Authentication failed:', err.message);
        logger.error('Full error:', err);
        process.exit(1);
    }
}

// Check command line arguments
const args = process.argv.slice(2);

// Run if called directly
if (require.main === module) {
    if (args.includes('--status')) {
        checkAuthStatus();
    } else {
        auth();
    }
}

module.exports = { auth, checkAuthStatus };

