/// <reference types="node" />
/// <reference path="./scripts/types/eslint-plugin-promise.d.ts" />
// @ts-check
// Oxlint executes supported public JS plugins in .oxlint-plugins.json.
// These rules retain ESLint's parser services, resolver functions or core semantics.
import eslintPluginComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslintPluginReact from '@eslint-react/eslint-plugin';
import eslintPluginStylistic from '@stylistic/eslint-plugin';
import eslintPluginQuery from '@tanstack/eslint-plugin-query';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import eslintPluginImport, { createNodeResolver } from 'eslint-plugin-import-x';
import eslintPluginJsxA11yX from 'eslint-plugin-jsx-a11y-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintPluginPromise from 'eslint-plugin-promise';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { sizeBaselineFiles } from './eslint.size-baseline.mjs';
import sourdawPlugin from './scripts/lint/sourdaw.mjs';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.Config[]} */
const sizeBaselineConfig = [];
if (sizeBaselineFiles.length > 0) {
    sizeBaselineConfig.push({
        files: sizeBaselineFiles,
        rules: { 'max-lines': 'warn', 'max-lines-per-function': 'warn', 'max-depth': 'warn', complexity: 'warn' },
    });
}

export default tseslint.config(
    eslintPluginComments.recommended,
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
        // Register moved rule names so their disable comments remain valid in
        // this pass. Only .oxlint-plugins.json enables their implementations.
        plugins: {
            '@eslint-react': eslintPluginReact,
            '@tanstack/query': eslintPluginQuery,
            '@typescript-eslint': tseslint.plugin,
            'import-x': eslintPluginImport,
            'promise-js': eslintPluginPromise,
            'jsx-a11y-x-js': eslintPluginJsxA11yX,
            'react-hooks-js': eslintPluginReactHooks,
            sourdaw: sourdawPlugin,
            '@stylistic': eslintPluginStylistic,
            '@eslint-community/eslint-comments':
                eslintPluginComments.recommended.plugins['@eslint-community/eslint-comments'],
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
            'import-x/resolver-next': [createTypeScriptImportResolver(), createNodeResolver()],
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
            parserOptions: { project: './server/tsconfig.json', tsconfigRootDir: import.meta.dirname },
        },
    },
    {
        rules: {
            '@eslint-react/no-leaked-conditional-rendering': 'error',
        },
    },
    {
        rules: {
            '@tanstack/query/no-rest-destructuring': 'warn',
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
            'no-octal': 'error',
            'preserve-caught-error': 'error',
            'no-useless-computed-key': 'error',
            'no-void': [
                'warn',
                {
                    allowAsStatement: true,
                },
            ],
            'import-x/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
                    pathGroups: [
                        {
                            pattern: 'react',
                            group: 'external',
                            position: 'before',
                        },
                        {
                            pattern: 'src/**',
                            group: 'internal',
                            position: 'before',
                        },
                    ],
                    pathGroupsExcludedImportTypes: ['react'],
                    'newlines-between': 'always',
                    alphabetize: {
                        order: 'asc',
                        caseInsensitive: true,
                    },
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
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: {
            'max-lines': [
                'error',
                {
                    max: 600,
                    skipBlankLines: true,
                    skipComments: true,
                },
            ],
            'max-lines-per-function': [
                'error',
                {
                    max: 100,
                    skipBlankLines: true,
                    skipComments: true,
                    IIFEs: true,
                },
            ],
            'max-depth': ['error', 4],
            complexity: ['error', 20],
        },
    },
    ...sizeBaselineConfig,
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
            'src/infra/store/storage/createLocalStorage.ts',
            'src/infra/store/storage/createPlainJsonLocalStorage.ts',
            'src/modules/Command/stores/undoSessionMirror.ts',
        ],
        rules: {
            'no-restricted-syntax': [
                'warn',
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
            'max-lines': 'off',
            'max-lines-per-function': 'off',
            'max-depth': 'off',
            complexity: 'off',
        },
    },
    {
        files: ['tests/e2e/**/*.ts'],
        rules: {
            'max-lines': 'off',
            'max-lines-per-function': 'off',
            'max-depth': 'off',
            complexity: 'off',
        },
    },
    {
        files: ['scripts/**/*.{js,mjs,cjs}', 'crates/daw-dsp/benches/wasm/**/*.{js,mjs,d.mts}'],
        extends: [tseslint.configs.disableTypeChecked, eslintPluginReact.configs['disable-type-checked']],
        languageOptions: { globals: globals.node, parserOptions: { project: false } },
    },
    { files: ['eslint.config.mjs'], languageOptions: { parserOptions: { project: './tsconfig.eslint-config.json' } } },
    {
        files: ['eslint.size-baseline.mjs', 'oxlint.craft-baseline.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: { parserOptions: { project: false } },
    },
    { files: ['**/*.d.ts'], extends: [tseslint.configs.disableTypeChecked] },
    // Keep formatting with core/import fixers so their final diagnostic pass
    // observes formatted line counts and their fixes converge together.
    eslintPluginPrettierRecommended
);
