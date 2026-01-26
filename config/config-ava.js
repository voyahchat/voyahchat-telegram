module.exports = {
    failFast: true,
    verbose: true,
    workerThreads: true,
    tap: false,
    concurrency: 1000,
    reporter: 'verbose',
    timeout: '2m',
    files: [
        'test/**/*.test.js',
    ],
    serial: false,
    babel: false,
    compileEnhancements: false,
    environmentVariables: {
        NODE_ENV: 'test',
    },
};
