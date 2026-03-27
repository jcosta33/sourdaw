/* (c) Copyright Sourdaw Ltd., all rights reserved. */

// @ts-check

import tsPlugin from '@typescript-eslint/eslint-plugin';

import base from './eslint.config.mjs';

export default [
    ...base,
    {
        files: ['**/*.ts', '**/*.tsx'],

        // Disable type-aware linting
        languageOptions: {
            parserOptions: {
                project: null,
                projectService: false,
            },
        },

        // Disable all rules that require type information
        rules: {
            ...Object.fromEntries(
                Object.entries(tsPlugin.rules)
                    .filter(([, rule]) => rule.meta?.docs?.requiresTypeChecking)
                    .map(([name]) => [`@typescript-eslint/${name}`, 'off'])
            ),

            // Manually-disabled (no requiresTypeChecking flag)
            '@eslint-react/no-unused-props': 'off',
            '@eslint-react/no-unstable-context-value': 'off',
            '@eslint-react/no-leaked-conditional-rendering': 'off',
            '@eslint-react/no-implicit-key': 'off',
        },

        // Prevent ESLint from removing disable comments during the fast pass
        //
        // This config disables type-aware rules for performance. Disable directives that
        // exist solely for those rules would be considered "unused" in this run and
        // auto-removed by --fix, breaking the subsequent full (type-aware) lint run.
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
];
