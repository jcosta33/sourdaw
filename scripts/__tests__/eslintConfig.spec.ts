import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import sourdawPlugin from '../lint/sourdaw.mjs';
import { lintMigratedRules } from './helpers/lintMigratedRules.ts';
import { typeQueryLintFixtures } from './helpers/typeQueryLintFixtures.ts';

const REACT_DEFAULT_IMPORT_SELECTOR =
    "ImportDeclaration[source.value='react'] :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)";
const LOCAL_STORAGE_CALL_SELECTOR = "CallExpression[callee.object.name='localStorage']";

const restrictedSyntaxFor = async (filePath: string) => {
    const config = await new ESLint().calculateConfigForFile(resolve(filePath));
    const entry: unknown = config?.rules['no-restricted-syntax'];
    if (!Array.isArray(entry)) {
        throw new TypeError(`ESLint resolved no no-restricted-syntax entry for ${filePath}`);
    }
    const [severity, ...options]: unknown[] = entry;
    const selectors = options.map((option) =>
        typeof option === 'object' && option !== null && 'selector' in option ? option.selector : option
    );
    return { severity, selectors };
};

describe('ESLint configuration', () => {
    it('keeps the local type-query helper compatible with the original TypeScript parser', async () => {
        const config = await new ESLint().calculateConfigForFile(resolve('src/app/bootstrap.ts'));
        const plugin = config?.plugins.sourdaw;
        const parser = config?.languageOptions.parser;
        if (!plugin || !parser) {
            throw new Error('ESLint did not register the local plugin and original parser');
        }
        const linter = new Linter();
        for (const fixture of typeQueryLintFixtures) {
            const lint = (code: string) =>
                linter.verify(
                    code,
                    {
                        files: ['**/*.ts'],
                        languageOptions: { parser },
                        plugins: { sourdaw: plugin },
                        rules: { [fixture.rule]: 'error' },
                    },
                    { filename: resolve(fixture.filename) }
                );
            expect(
                lint(fixture.invalid).map((message) => message.ruleId),
                fixture.rule
            ).toEqual([fixture.rule]);
            expect(lint(fixture.valid), fixture.rule).toEqual([]);
        }
    });
    it('runs both lint engines on the config', () => {
        const result = spawnSync(process.execPath, ['scripts/runLint.ts', 'eslint.config.mjs'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
            timeout: 120_000,
        });

        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toMatch(/lint: oxlint passed/);
        expect(result.stdout).toMatch(/lint: oxlint-plugins passed/);
        expect(result.stdout).toMatch(/lint: eslint passed/);
    }, 130_000);

    it('rejects default exports outside the required root config', () => {
        const directory = mkdtempSync(resolve('.eslint-config-regression-'));
        const ordinary = `${directory}.mjs`;
        const nestedConfig = join(directory, 'eslint.config.mjs');
        try {
            writeFileSync(ordinary, 'export default 1;\n');
            writeFileSync(nestedConfig, 'export default 1;\n');
            const result = spawnSync(
                resolve('node_modules/.bin/oxlint'),
                ['--quiet', '--threads=2', '--format=agent', ordinary, nestedConfig],
                { cwd: process.cwd(), encoding: 'utf8' }
            );
            expect(result.status, result.stderr).toBe(1);
            expect(result.stdout).toContain(
                `${relative(process.cwd(), ordinary)}:1:8: error import(no-default-export)`
            );
            expect(result.stdout).toContain(
                `${relative(process.cwd(), nestedConfig)}:1:8: error import(no-default-export)`
            );
        } finally {
            unlinkSync(ordinary);
            unlinkSync(nestedConfig);
            rmdirSync(directory);
        }
    });

    it('rejects missing, unmatched, unsupported and partially missing production targets', () => {
        const directory = mkdtempSync(resolve('scripts/lint-targets-'));
        const valid = join(directory, 'valid.ts');
        const missing = join(directory, 'missing.ts');
        const unsupported = join(directory, 'example.rs');
        try {
            writeFileSync(valid, 'export const value = 1;\n');
            writeFileSync(unsupported, 'fn main() {}\n');
            for (const targets of [[missing], [join(directory, 'absent/**/*.ts')], [unsupported], [valid, missing]]) {
                const result = spawnSync(process.execPath, ['scripts/runLint.ts', ...targets], {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    timeout: 120_000,
                    env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
                });
                expect(result.status, result.stdout + result.stderr).toBe(1);
            }
        } finally {
            unlinkSync(valid);
            unlinkSync(unsupported);
            rmdirSync(directory);
        }
    }, 180_000);

    it('applies the production Oxlint custom rules to invalid and valid TypeScript', () => {
        expect(lintMigratedRules('enum Fruit { Apple }\n').messages.map((message) => message.ruleId)).toContain(
            'sourdaw/no-enum'
        );
        expect(
            lintMigratedRules('const fruit = { Apple: 1 } as const;\n').messages.map((message) => message.ruleId)
        ).not.toContain('sourdaw/no-enum');
    }, 60_000);

    it('rejects a migrated violation in the production runner and accepts its valid replacement', () => {
        const directory = mkdtempSync(resolve('scripts/lint-route-'));
        const fixture = join(directory, 'example.ts');
        const run = () =>
            spawnSync(process.execPath, ['scripts/runLint.ts', fixture], {
                cwd: process.cwd(),
                encoding: 'utf8',
                timeout: 120_000,
                env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
            });
        try {
            writeFileSync(fixture, 'export enum Fruit {\n    Apple,\n}\n');
            const rejected = run();
            expect(rejected.status, rejected.stdout + rejected.stderr).toBe(1);
            expect(rejected.stdout).toContain('lint: oxlint passed');
            expect(rejected.stdout).toContain('error sourdaw(no-enum)');
            expect(rejected.stdout).toContain('lint: oxlint-plugins failed');
            expect(rejected.stdout).not.toContain('lint: eslint started');
            writeFileSync(fixture, 'export const fruit = { Apple: 1 } as const;\n');
            const accepted = run();
            expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
            expect(accepted.stdout).toContain('lint: oxlint-plugins passed');
            expect(accepted.stdout).toContain('lint: eslint passed');
        } finally {
            unlinkSync(fixture);
            rmdirSync(directory);
        }
    }, 180_000);

    it('bans default React imports and direct storage calls in production TSX', async () => {
        const selectors = await restrictedSyntaxFor('src/app/App.tsx');

        expect(selectors.severity).toBe(2);
        expect(selectors.selectors).toContain(REACT_DEFAULT_IMPORT_SELECTOR);
        expect(selectors.selectors).toContain(LOCAL_STORAGE_CALL_SELECTOR);
    });

    it('keeps the default React import ban in spec TSX', async () => {
        const selectors = await restrictedSyntaxFor('src/app/__tests__/App.spec.tsx');

        expect(selectors.severity).toBe(2);
        expect(selectors.selectors).toContain(REACT_DEFAULT_IMPORT_SELECTOR);
        expect(selectors.selectors).not.toContain(LOCAL_STORAGE_CALL_SELECTOR);
    });

    it('keeps the direct storage restriction non-failing in production TypeScript', async () => {
        const selectors = await restrictedSyntaxFor('src/app/bootstrap.ts');

        expect(selectors.severity).toBe(1);
        expect(selectors.selectors).toContain(LOCAL_STORAGE_CALL_SELECTOR);
        expect(selectors.selectors).not.toContain(REACT_DEFAULT_IMPORT_SELECTOR);
    });

    it('enables no rule or restricted import for the removed Tauri bridge', async () => {
        const eslint = new ESLint();
        const config = await eslint.calculateConfigForFile(
            resolve('src/modules/Example/presentations/components/Example.tsx')
        );
        if (!config) {
            throw new Error('ESLint did not load the presentation configuration');
        }
        const sourdawRules = Object.keys(sourdawPlugin.rules);

        expect(sourdawRules).toContain('no-type-assertion-escape');
        expect(sourdawRules.filter((name) => /tauri/i.test(name))).toEqual([]);
        expect(Object.keys(config.rules).filter((name) => /tauri/i.test(name))).toEqual([]);
        expect(readFileSync('.oxlintrc.json', 'utf8')).toContain('no-restricted-imports');
        expect(readFileSync('.oxlintrc.json', 'utf8')).not.toMatch(/tauri/i);
    });

    it('reports every assertion escape and no ordinary assertion', async () => {
        const messages = sourdawPlugin.rules['no-type-assertion-escape'].meta.messages;
        const lint = (code: string, _ruleEntry: unknown) =>
            lintMigratedRules(code, 'src/modules/Example/useCases/example.ts')
                .messages.filter((message) => message.ruleId === 'sourdaw/no-type-assertion-escape')
                .map((message) => Object.entries(messages).find(([, text]) => text === message.message)?.[0]);
        const migration = JSON.parse(readFileSync('.oxlint-plugins.json', 'utf8'));
        const production = migration.overrides.find(
            (entry: { files: string[] }) => entry.files[0] === '**/*.{ts,tsx,mts,cts}'
        ).rules['sourdaw/no-type-assertion-escape'];
        const assertionScopes = migration.overrides
            .filter(
                (entry: { rules?: Record<string, unknown> }) =>
                    entry.rules?.['sourdaw/no-type-assertion-escape'] !== undefined
            )
            .map((entry: { files: string[]; rules: Record<string, unknown> }) => [
                entry.files,
                entry.rules['sourdaw/no-type-assertion-escape'],
            ]);
        expect(assertionScopes).toEqual([
            [['**/*.{ts,tsx,mts,cts}'], 'error'],
            [
                [
                    '**/*.spec.{ts,tsx}',
                    '**/*.test.{ts,tsx}',
                    '**/setupTests.ts',
                    '**/*.mock.ts',
                    '**/__tests__/**/*.{ts,tsx}',
                    'src/**/testing/**/*.{ts,tsx}',
                ],
                'off',
            ],
        ]);

        expect(production).toBe('error');
        expect(lint('const value = input as never;', production)).toEqual(['noAsNever']);
        expect(lint('const value = input as any;', production)).toEqual(['noAsAny']);
        expect(lint('const value = input as unknown as Thing;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = [1, 2] as const;', production)).toEqual([]);
        expect(lint('const value = input as Thing;', production)).toEqual([]);
        expect(lint('const value = input as unknown;', production)).toEqual([]);

        expect(lint('const value = <never>input;', production)).toEqual(['noAsNever']);
        expect(lint('const value = <any>input;', production)).toEqual(['noAsAny']);
        expect(lint('const value = <Thing>(<unknown>input);', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = <Thing>(input as unknown);', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = (<unknown>input) as Thing;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = <Thing>input;', production)).toEqual([]);
        expect(lint('const value = <unknown>input;', production)).toEqual([]);

        expect(lint('const value = (input as unknown)! as Thing;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = (input as unknown satisfies unknown) as Thing;', production)).toEqual([
            'noAsUnknownAs',
        ]);
        expect(lint('const value = <Thing>(<unknown>input)!;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = <Thing>(<unknown>input satisfies unknown);', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = input!;', production)).toEqual([]);
        expect(lint('const value = (input as Thing)!;', production)).toEqual([]);
        expect(lint('const value = (input as Thing)! as Other;', production)).toEqual([]);

        const restoreHandler = lintMigratedRules(
            'const value = input as never;',
            'src/modules/Example/handlers/restore/handleRestoreTrack.ts'
        );
        expect(
            restoreHandler.messages
                .filter((message) => message.ruleId === 'sourdaw/no-type-assertion-escape')
                .map((message) => message.message)
        ).toEqual([messages.noAsNever]);
    }, 180_000);

    it('preserves custom rule diagnostics through the loaded plugin', async () => {
        const cases = [
            {
                rule: 'no-useeffect-fetching',
                messageId: 'noUseEffectFetching',
                filename: 'src/modules/Example/presentations/hooks/useExample.tsx',
                invalid: 'useEffect(() => { if (ready) { fetch(url); } }, []);',
                valid: 'useEffect(() => { if (ready) { updateView(); } }, []);',
            },
            {
                rule: 'no-useeffect-derived-state',
                messageId: 'noDerivedStateEffect',
                filename: 'src/modules/Example/presentations/hooks/useExample.tsx',
                invalid: 'React.useLayoutEffect(() => { if (ready) { setValue(value); } }, [value]);',
                valid: 'React.useLayoutEffect(() => { if (ready) { setValue(fetch(url)); } }, [value]);',
            },
            {
                rule: 'no-useeffect-derived-state',
                messageId: 'noDerivedStateEffect',
                filename: 'src/modules/Example/presentations/hooks/useExample.tsx',
                invalid: 'useEffect(() => { setActiveDevice(id); }, [id]);',
                valid: 'useEffect(() => { setActiveDevice(id); return () => setActiveDevice(null); }, [id]);',
            },
            {
                rule: 'no-multiple-function-exports',
                messageId: 'noMultipleFunctionExports',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid:
                    "import { inject as wire } from '#/infra/di/inject'; export const first = wire(deps)(() => 1); export const second = () => 2;",
                valid: "import { inject as wire } from '#/infra/di/inject'; export const first = wire(deps)(() => 1); export const second = 2;",
            },
            {
                rule: 'no-type-only-private-module-import',
                messageId: 'noTypeOnlyPrivateModuleImport',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid: "import type { Thing } from '#/modules/Other/models/Thing';",
                valid: "import type { Thing } from '#/modules/Example/models/Thing';",
            },
            {
                rule: 'no-type-assertion-escape',
                messageId: 'noAsUnknownAs',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid: 'const value = input as unknown as string;',
                valid: 'const value = input as unknown;',
            },
            {
                rule: 'no-type-assertion-escape',
                messageId: 'noAsAny',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid: 'const value = input as any;',
                valid: 'const value = input as string;',
            },
        ];

        for (const fixture of cases) {
            const lint = (code: string) =>
                lintMigratedRules(code, fixture.filename).messages.filter(
                    (message) => message.ruleId === `sourdaw/${fixture.rule}`
                );
            const definition = Object.entries(sourdawPlugin.rules).find(([name]) => name === fixture.rule)?.[1];
            const interpolated = new Map([
                [
                    'noMultipleFunctionExports',
                    'Use-case and repository files must export at most one function value. Found 2 exported functions: first, second.',
                ],
                [
                    'noTypeOnlyPrivateModuleImport',
                    'Do not import types from another module private folder (`models`). Use an events contract, public value contract derivation, or a local consumer-owned type.',
                ],
            ]);
            const expected =
                interpolated.get(fixture.messageId) ??
                Object.entries(definition?.meta.messages ?? {}).find(([name]) => name === fixture.messageId)?.[1];
            expect(
                lint(fixture.invalid).map((message) => message.message),
                fixture.rule
            ).toEqual([expected]);
            expect(lint(fixture.valid), fixture.rule).toEqual([]);
        }

        expect(
            lintMigratedRules('task.then(value => Promise.resolve(value));')
                .messages.filter((message) => message.ruleId === 'promise-js/no-return-wrap')
                .map((message) => message.message)
        ).toHaveLength(1);
        expect(
            lintMigratedRules('task.then(value => value);').messages.filter(
                (message) => message.ruleId === 'promise-js/no-return-wrap'
            )
        ).toEqual([]);
    }, 180_000);
});
