import js from '@eslint/js';
import globals from 'globals';
import yml from 'eslint-plugin-yml';

export default [
    js.configs.recommended,

    {
        // Global configuration
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.commonjs,
            },
        },

        rules: {
            'indent': ['error', 4], // 4 spaces
            'brace-style': ['error', '1tbs', { 'allowSingleLine': true }], // brace on same line
            'max-len': ['error', {
                'code': 120, // 120 char line length
            }],
            'comma-dangle': ['error', 'always-multiline'], // trailing commas
            'function-paren-newline': ['error', 'multiline-arguments'], // multiline args
            'function-call-argument-newline': ['error', 'consistent'], // consistent line breaks in args

            // Essential rules from recommended
            'no-console': 'off',      // allow console in build scripts
            'no-process-exit': 'off', // allow process.exit
            'no-unused-vars': ['error', {
                'vars': 'all',
                'args': 'after-used',
                'ignoreRestSiblings': false,
                'argsIgnorePattern': '^_',
                'caughtErrors': 'none', // allow unused error params in catch blocks
            }],

            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'eol-last': 'error',
            'no-trailing-spaces': 'error',
        },
    },

    // YAML configuration
    ...yml.configs['flat/recommended'],

    {
        ignores: [
            'config/config-eslint.mjs',
            'config/auth.yml',
        ],
    },
];
