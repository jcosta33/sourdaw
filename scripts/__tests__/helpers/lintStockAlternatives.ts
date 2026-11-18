import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { type Linter } from 'eslint';

import { withLintFixture } from './lintMigratedRules.ts';

type Subject = 'imports' | 'computed' | 'format';
type Options = {
    subject: Subject;
    fix: boolean;
    prettier?: boolean;
    jsonResolver?: boolean;
    canonicalAlias?: boolean;
    typescriptOnly?: boolean;
    production?: boolean;
};
type Diagnostic = { ruleId: string | null; message: string };
type Result = { status: number; messages: Diagnostic[]; text: string; output: string };

// Frozen independently of production assignment: changing an engine's rule inventory
// must not silently change the original import grouping or resolver-chain oracle.
const importOrder = {
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
    pathGroups: [
        { pattern: 'react', group: 'external', position: 'before' },
        { pattern: 'src/**', group: 'internal', position: 'before' },
    ],
    pathGroupsExcludedImportTypes: ['react'],
    'newlines-between': 'always',
    alphabetize: { order: 'asc', caseInsensitive: true },
};
const jsonResolver = { 'import-x/resolver': { typescript: true, node: { preserveSymlinks: false } } };

function stockResolverSettings(options: Options) {
    if (options.typescriptOnly) {
        return { 'import-x/resolver': { typescript: true } };
    }
    return jsonResolver;
}

function stockRules(engine: 'eslint' | 'oxlint', options: Options): Linter.RulesRecord {
    const rules: Linter.RulesRecord = {};
    if (options.subject === 'imports') {
        let name = 'import-x-js/order';
        if (engine === 'eslint' && !options.canonicalAlias) {
            name = 'import-x/order';
        }
        rules[name] = ['error', importOrder];
    }
    if (options.subject === 'computed') {
        rules['no-useless-computed-key'] = 'error';
    }
    if (options.prettier !== false) {
        rules['prettier/prettier'] = 'error';
    }
    return rules;
}

function stockArguments(engine: 'eslint' | 'oxlint', config: string, options: Options, root: string): string[] {
    if (engine === 'eslint') {
        return ['--no-config-lookup', '--config', config, '--format=json'];
    }
    let selectedConfig = config;
    if (options.production) {
        selectedConfig = join(root, '.oxlint-plugins.json');
    }
    return [`--config=${selectedConfig}`, '--threads=2', '--format=json'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diagnostic(value: unknown, engine: 'eslint' | 'oxlint'): Diagnostic {
    if (!isRecord(value) || typeof value.message !== 'string') {
        throw new Error(`Invalid ${engine} diagnostic: ${JSON.stringify(value)}`);
    }
    if (engine === 'oxlint' && typeof value.code === 'string') {
        return { ruleId: value.code.replace(/\(([^)]+)\)$/, '/$1'), message: value.message };
    }
    if (engine === 'eslint' && (typeof value.ruleId === 'string' || value.ruleId === null)) {
        return { ruleId: value.ruleId, message: value.message };
    }
    throw new Error(`Missing ${engine} rule ID: ${JSON.stringify(value)}`);
}

/** Isolated stock CLI probes; no production parser project, plugin adapters or custom fix loop. */
export function withStockLintAlternatives<Value>(
    code: string,
    inspect: (probe: {
        reset(text?: string): void;
        eslint(options: Options): Result;
        oxlint(options: Options): Result;
    }) => Value,
    fixtureOptions: { filename?: string; prepare?: (fixture: string) => void } = {}
): Value {
    return withLintFixture(code, fixtureOptions.filename ?? 'scripts/example.js', (fixture, root) => {
        fixtureOptions.prepare?.(fixture);
        const configDirectory = mkdtempSync(join(dirname(fixture), 'lint-stock-config-'));
        const configuration = join(configDirectory, 'stock-alternative');
        const run = (engine: 'eslint' | 'oxlint', options: Options): Result => {
            const resolverSettings = stockResolverSettings(options);
            const rules = stockRules(engine, options);
            const config = `${configuration}.${engine === 'eslint' ? 'mjs' : 'json'}`;
            if (engine === 'eslint') {
                let resolverSource =
                    "{ 'import-x/resolver-next': [createTypeScriptImportResolver(), createNodeResolver()] }";
                if (options.jsonResolver || options.canonicalAlias) {
                    resolverSource = JSON.stringify(resolverSettings);
                }
                writeFileSync(
                    config,
                    `
                    import tseslint from 'typescript-eslint';
                    import importPlugin, { createNodeResolver } from 'eslint-plugin-import-x';
                    import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
                    import prettierPlugin from 'eslint-plugin-prettier';
                    export default [{
                        files: ['**/*.{js,jsx,ts,tsx,mts,cts,mjs,cjs}'],
                        linterOptions: { reportUnusedDisableDirectives: false },
                        languageOptions: { parser: tseslint.parser, sourceType: 'module' },
                        plugins: { 'import-x': importPlugin, 'import-x-js': importPlugin, prettier: prettierPlugin },
                        settings: ${resolverSource},
                        rules: ${JSON.stringify({ ...rules, 'import-x/order': 'off', 'import-x-js/order': 'off' })},
                    }, {
                        files: ['**/*.{js,jsx,ts,tsx,mts,cts}'],
                        rules: ${JSON.stringify(rules)},
                    }];
                `
                );
            } else {
                writeFileSync(
                    config,
                    JSON.stringify({
                        plugins: [],
                        jsPlugins: [
                            { name: 'import-x-js', specifier: 'eslint-plugin-import-x' },
                            { name: 'prettier', specifier: 'eslint-plugin-prettier' },
                        ],
                        categories: Object.fromEntries(
                            ['correctness', 'suspicious', 'pedantic', 'perf', 'style', 'restriction', 'nursery'].map(
                                (category) => [category, 'off']
                            )
                        ),
                        settings: jsonResolver,
                        rules: Object.fromEntries(Object.entries(rules).filter(([name]) => !name.endsWith('/order'))),
                        overrides: [{ files: ['**/*.{js,jsx,ts,tsx,mts,cts}'], rules }],
                    })
                );
            }
            const args = stockArguments(engine, config, options, root);
            if (options.fix) {
                args.push('--fix');
            }
            args.push(fixture);
            const result = spawnSync(resolve('node_modules/.bin', engine), args, {
                cwd: root,
                encoding: 'utf8',
                timeout: 60_000,
            });
            const output = result.stdout + result.stderr;
            if (result.error || (result.status !== 0 && result.status !== 1)) {
                throw new Error(`${engine} did not complete: ${result.error?.message ?? output}`);
            }
            const parsed: unknown = JSON.parse(result.stdout);
            let messages: unknown[];
            if (engine === 'eslint') {
                if (
                    !Array.isArray(parsed) ||
                    parsed.length !== 1 ||
                    !isRecord(parsed[0]) ||
                    !Array.isArray(parsed[0].messages)
                ) {
                    throw new Error(`ESLint did not observe exactly one fixture: ${output}`);
                }
                messages = parsed[0].messages;
            } else {
                if (!isRecord(parsed) || parsed.number_of_files !== 1 || !Array.isArray(parsed.diagnostics)) {
                    throw new Error(`Oxlint did not observe exactly one fixture: ${output}`);
                }
                messages = parsed.diagnostics;
            }
            return {
                status: result.status,
                messages: messages.map((message) => diagnostic(message, engine)),
                text: readFileSync(fixture, 'utf8'),
                output,
            };
        };
        try {
            return inspect({
                reset: (text = code) => writeFileSync(fixture, text),
                eslint: (options) => run('eslint', options),
                oxlint: (options) => run('oxlint', options),
            });
        } finally {
            rmSync(configDirectory, { recursive: true, force: true });
        }
    });
}
