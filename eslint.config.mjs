/// <reference types="node" />
/// <reference path="./scripts/types/eslint-plugin-promise.d.ts" />
// @ts-check
// Oxlint executes supported public JS plugins in .oxlint-plugins.json.
// These rules retain ESLint's parser services or core semantics.
import { readFileSync } from 'node:fs';

import eslintPluginComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslintPluginReact from '@eslint-react/eslint-plugin';
import eslintPluginStylistic from '@stylistic/eslint-plugin';
import eslintPluginQuery from '@tanstack/eslint-plugin-query';
import eslintPluginImport from 'eslint-plugin-import-x';
import eslintPluginJsxA11yX from 'eslint-plugin-jsx-a11y-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintPluginPromise from 'eslint-plugin-promise';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import sourdawPlugin from './scripts/lint/sourdaw.mjs';
import sourdawCraftPlugin from './scripts/oxlintCraft/plugin.mjs';

const jsxA11yPlugin = eslintPluginJsxA11yX.configs.recommended.plugins['jsx-a11y-x'];
const commentsPlugin = eslintPluginComments.recommended.plugins?.['@eslint-community/eslint-comments'];
if (!commentsPlugin) {
    throw new Error('The recommended comments config did not register @eslint-community/eslint-comments');
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is import('eslint').Linter.Severity | import('eslint').Linter.StringSeverity} */
function isSeverity(value) {
    return value === 0 || value === 1 || value === 2 || value === 'off' || value === 'warn' || value === 'error';
}

/** @param {unknown} value @param {string} location @returns {import('eslint').Linter.RulesRecord} */
function movedFixRules(value, location) {
    if (!isRecord(value)) {
        throw new TypeError(`Invalid moved lint rules at ${location}`);
    }
    /** @type {import('eslint').Linter.RulesRecord} */
    const rules = {};
    for (const [name, setting] of Object.entries(value)) {
        if (isSeverity(setting)) {
            rules[name] = setting;
            continue;
        }
        if (Array.isArray(setting) && isSeverity(setting[0])) {
            /** @type {unknown[]} */
            const options = setting.slice(1);
            rules[name] = [setting[0], ...options];
            continue;
        }
        throw new TypeError(`Invalid moved lint severity at ${location}.${name}`);
    }
    return rules;
}

/** @param {unknown} value @param {string} location @returns {string[]} */
function movedFixPatterns(value, location) {
    if (!Array.isArray(value) || !value.every((pattern) => typeof pattern === 'string')) {
        throw new TypeError(`Invalid moved lint file patterns at ${location}`);
    }
    return value;
}

/** @returns {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} */
function movedFixConfig() {
    if (process.env.SOURDAW_LINT_COFIX !== '1') {
        return [];
    }
    /** @type {unknown} */
    const config = JSON.parse(readFileSync(new URL('./.oxlint-plugins.json', import.meta.url), 'utf8'));
    if (!isRecord(config) || !isRecord(config.settings) || !Array.isArray(config.overrides)) {
        throw new TypeError('Invalid moved lint configuration in .oxlint-plugins.json');
    }
    /** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} */
    const configs = [{ settings: config.settings, rules: movedFixRules(config.rules, 'rules') }];
    for (const [index, override] of config.overrides.entries()) {
        if (!isRecord(override)) {
            throw new TypeError(`Invalid moved lint override at overrides[${index}]`);
        }
        for (const field of Object.keys(override)) {
            if (!['files', 'excludeFiles', 'env', 'rules'].includes(field)) {
                throw new TypeError(`Unsupported moved lint override field at overrides[${index}].${field}`);
            }
        }
        if (override.rules === undefined) {
            continue;
        }
        /** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config} */
        const entry = {
            files: movedFixPatterns(override.files, `overrides[${index}].files`),
            rules: movedFixRules(override.rules, `overrides[${index}].rules`),
        };
        if (override.excludeFiles !== undefined) {
            entry.ignores = movedFixPatterns(override.excludeFiles, `overrides[${index}].excludeFiles`);
        }
        configs.push(entry);
    }
    return configs;
}

export default tseslint.config(
    eslintPluginComments.recommended,
    // Counted bulk suppressions are an ESLint CLI contract. These promoted
    // rules stay here until Oxlint exposes an equivalent stable public API.
    {
        rules: {
            '@eslint-react/exhaustive-deps': 'error',
            '@eslint-react/naming-convention-context-name': 'error',
            '@eslint-react/naming-convention-ref-name': 'error',
            '@eslint-react/no-array-index-key': 'error',
            '@eslint-react/set-state-in-effect': 'error',
            '@eslint-react/use-state': 'error',
            'react-hooks/exhaustive-deps': 'error',
            'react-hooks/refs': 'error',
            'react-hooks/set-state-in-effect': 'error',
        },
    },
    {
        ignores: [
            'build/',
            'dist/',
            'node_modules/',
            'public/',
            'coverage/',
            'storybook-static/',
            'electron/out/**',
            '.agents/',
            'src/routeTree.gen.ts',
            'src/modules/AudioEngine/wasm/*.js',
            'src/modules/AudioEngine/wasm/*.d.ts',
            'src/modules/AudioRendering/workers/vendor/vorbis/ogg-encode.js',
            'src/modules/AudioRendering/workers/vendor/vorbis/ogg-encode.d.ts',
            'src/modules/AudioRendering/workers/vendor/opus/opus-encode.js',
            'src/modules/AudioRendering/workers/vendor/opus/opus-encode.d.ts',
            'src/modules/AudioRendering/workers/vendor/opus/core.js',
            'src/modules/AudioRendering/workers/vendor/vorbis/vorbis.wasm.js',
            'src/modules/AudioRendering/workers/vendor/opus/src/opus.wasm.js',
            'test-debug.mjs',
            'test-manual-fix.mjs',
            'test-manual-fix.ts',
            '**/*.md',
            'scripts/oxlintCraft/__tests__/fixtures/**',
        ],
    },
    {
        linterOptions: { reportUnusedDisableDirectives: false },
        // Keep canonical and historical names available for directive validation.
        // Bulk-owned hook rules keep their original names; cofix projects moved names.
        plugins: {
            '@eslint-react': eslintPluginReact,
            '@tanstack/query': eslintPluginQuery,
            '@typescript-eslint': tseslint.plugin,
            'import-x': eslintPluginImport,
            'import-x-js': eslintPluginImport,
            'promise-js': eslintPluginPromise,
            promise: eslintPluginPromise,
            'jsx-a11y-x-js': jsxA11yPlugin,
            'jsx-a11y-x': jsxA11yPlugin,
            'react-hooks-js': eslintPluginReactHooks,
            'react-hooks': eslintPluginReactHooks,
            sourdaw: sourdawPlugin,
            'sourdaw-craft': sourdawCraftPlugin,
            '@stylistic': eslintPluginStylistic,
            '@eslint-community/eslint-comments': commentsPlugin,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser,
            parser: tseslint.parser,
            parserOptions: {
                project: './tsconfig.eslint.json',
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: { jsx: true },
            },
        },
        settings: {
            ...eslintPluginReact.configs['recommended-type-checked'].settings,
            react: { version: 'detect' },
        },
    },
    {
        files: ['tests/e2e/**/*.ts'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser },
            parserOptions: { project: './tsconfig.e2e.json', tsconfigRootDir: import.meta.dirname },
        },
    },
    {
        files: ['server/**/*.ts'],
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                project: ['./server/tsconfig.json', './server/__tests__/tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            '@eslint-react/no-leaked-conditional-rendering': 'error',
        },
    },
    {
        rules: {
            '@tanstack/query/no-void-query-fn': 'error',
        },
    },
    {
        rules: {
            '@tanstack/query/no-rest-destructuring': 'error',
        },
    },
    {
        files: ['**/*.{js,jsx,ts,tsx,mts,cts}'],
        rules: {
            'consistent-return': 'error',
            'no-invalid-this': 'error',
            'no-void': [
                'error',
                {
                    allowAsStatement: true,
                },
            ],
        },
    },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: {
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'typeParameter',
                    format: ['PascalCase'],
                    custom: {
                        regex: '^.{2,}$',
                        match: true,
                    },
                },
            ],
            'id-length': [
                'error',
                {
                    min: 2,
                    exceptions: [
                        '_',
                        'x',
                        'y',
                        'z',
                        'w',
                        'h',
                        'r',
                        'g',
                        'b',
                        'a',
                        'i',
                        'j',
                        'k',
                        'v',
                        'e',
                        't',
                        'c',
                        'd',
                        'f',
                        'm',
                        'q',
                        's',
                        'u',
                        'p',
                        'l',
                        'n',
                        'A',
                        'B',
                        'C',
                        'D',
                        'E',
                        'F',
                        'G',
                        'H',
                        'I',
                        'J',
                        'K',
                        'L',
                        'M',
                        'N',
                        'O',
                        'P',
                        'Q',
                        'R',
                        'S',
                        'T',
                        'U',
                        'V',
                        'W',
                        'X',
                        'Y',
                        'Z',
                    ],
                    properties: 'never',
                },
            ],
        },
    },
    {
        files: ['**/*.{tsx,jsx}'],
        rules: {
            '@eslint-react/no-leaked-conditional-rendering': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "ImportDeclaration[source.value='react'] :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)",
                    message:
                        'Default React import not allowed since we use the TypeScript jsx-transform. If you need a global type that collides with a React named export (such as `MouseEvent`), use `globalThis.MouseEvent`.',
                },
            ],
        },
    },
    {
        files: ['**/*.{ts,mts,cts}'],
        ignores: [
            '**/*.spec.ts',
            // Browser end-to-end helpers seed and read page storage the way a spec does.
            'tests/e2e/**/*.ts',
            'src/infra/store/storage/createLocalStorage.ts',
            'src/infra/store/storage/createPlainJsonLocalStorage.ts',
            'src/modules/Command/stores/undoSessionMirror.ts',
        ],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: "CallExpression[callee.object.name='localStorage']",
                    message:
                        'Do not use `localStorage` directly; go through a storage adapter in `src/infra/store/storage/` or a repository.',
                },
                {
                    selector:
                        "CallExpression[callee.object.object.name='window'][callee.object.property.name='localStorage']",
                    message:
                        'Do not use `localStorage` directly; go through a storage adapter in `src/infra/store/storage/` or a repository.',
                },
                {
                    selector: "CallExpression[callee.object.name='sessionStorage']",
                    message: 'Do not use `sessionStorage` directly; go through a repository that owns the key.',
                },
                {
                    selector:
                        "CallExpression[callee.object.object.name='window'][callee.object.property.name='sessionStorage']",
                    message: 'Do not use `sessionStorage` directly; go through a repository that owns the key.',
                },
            ],
        },
    },
    {
        files: ['**/*.tsx'],
        ignores: ['**/*.spec.tsx'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "ImportDeclaration[source.value='react'] :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)",
                    message:
                        'Default React import not allowed since we use the TypeScript jsx-transform. If you need a global type that collides with a React named export (such as `MouseEvent`), use `globalThis.MouseEvent`.',
                },
                {
                    selector: "CallExpression[callee.object.name='localStorage']",
                    message:
                        'Do not use `localStorage` directly; go through a storage adapter in `src/infra/store/storage/` or a repository.',
                },
                {
                    selector:
                        "CallExpression[callee.object.object.name='window'][callee.object.property.name='localStorage']",
                    message:
                        'Do not use `localStorage` directly; go through a storage adapter in `src/infra/store/storage/` or a repository.',
                },
                {
                    selector: "CallExpression[callee.object.name='sessionStorage']",
                    message: 'Do not use `sessionStorage` directly; go through a repository that owns the key.',
                },
                {
                    selector:
                        "CallExpression[callee.object.object.name='window'][callee.object.property.name='sessionStorage']",
                    message: 'Do not use `sessionStorage` directly; go through a repository that owns the key.',
                },
            ],
        },
    },
    {
        files: [
            '**/*.spec.{ts,tsx}',
            '**/*.test.{ts,tsx}',
            '**/setupTests.ts',
            '**/*.mock.ts',
            '**/__tests__/**/*.{ts,tsx}',
            'src/**/testing/**/*.{ts,tsx}',
        ],
        rules: {
            'id-length': 'off',
            '@typescript-eslint/naming-convention': 'off',
        },
    },
    ...movedFixConfig(),
    {
        files: ['scripts/**/*.{js,mjs,cjs}', 'crates/daw-dsp/benches/wasm/**/*.{js,mjs,d.mts}'],
        extends: [tseslint.configs.disableTypeChecked, eslintPluginReact.configs['disable-type-checked']],
        languageOptions: { globals: globals.node, parserOptions: { project: false } },
    },
    { files: ['eslint.config.mjs'], languageOptions: { parserOptions: { project: './tsconfig.eslint-config.json' } } },
    {
        files: ['eslint.size-baseline.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: { parserOptions: { project: false } },
    },
    { files: ['**/*.d.ts'], extends: [tseslint.configs.disableTypeChecked] },
    // Keep formatting with core/import fixers so their final diagnostic pass
    // observes formatted line counts and their fixes converge together.
    eslintPluginPrettierRecommended
);
