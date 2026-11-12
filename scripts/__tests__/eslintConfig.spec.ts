import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('ESLint configuration', () => {
    it('runs both lint engines on the config', () => {
        const result = spawnSync(process.execPath, ['scripts/runLint.ts', 'eslint.config.mjs'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
            timeout: 120_000,
        });

        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toMatch(/lint: oxlint passed/);
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
            expect(result.stdout).toContain(`${ordinary}:1:8: error import(no-default-export)`);
            expect(result.stdout).toContain(`${nestedConfig}:1:8: error import(no-default-export)`);
        } finally {
            unlinkSync(ordinary);
            unlinkSync(nestedConfig);
            rmdirSync(directory);
        }
    });

    it('loads the config and applies custom rules to invalid and valid TypeScript', async () => {
        const eslint = new ESLint();
        const filePath = resolve('src/app/bootstrap.ts');
        const [invalid] = await eslint.lintText('enum Fruit { Apple }\n', { filePath });
        const [valid] = await eslint.lintText('const fruit = { Apple: 1 } as const;\n', { filePath });

        expect(invalid.messages.map((message) => message.ruleId)).toContain('sourdaw/no-enum');
        expect(valid.messages.map((message) => message.ruleId)).not.toContain('sourdaw/no-enum');
        expect(valid.messages.filter((message) => message.fatal)).toEqual([]);
    }, 60_000);

    it('preserves custom rule diagnostics through the loaded plugin', async () => {
        const eslint = new ESLint();
        const config = await eslint.calculateConfigForFile(resolve('src/app/bootstrap.ts'));
        expect(config).toBeDefined();
        const plugin = config.plugins.sourdaw;
        const parser = config.languageOptions.parser;
        expect(plugin).toBeDefined();
        expect(parser).toBeDefined();

        const linter = new Linter();
        const cases = [
            {
                rule: 'no-useeffect-fetching',
                messageId: 'noUseEffectFetching',
                filename: 'src/modules/Example/presentations/hooks/useExample.ts',
                invalid: 'useEffect(() => { if (ready) { fetch(url); } }, []);',
                valid: 'useEffect(() => { if (ready) { updateView(); } }, []);',
            },
            {
                rule: 'no-useeffect-derived-state',
                messageId: 'noDerivedStateEffect',
                filename: 'src/modules/Example/presentations/hooks/useExample.ts',
                invalid: 'React.useLayoutEffect(() => { if (ready) { setValue(value); } }, [value]);',
                valid: 'React.useLayoutEffect(() => { if (ready) { setValue(fetch(url)); } }, [value]);',
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
                linter.verify(
                    code,
                    {
                        languageOptions: { parser },
                        plugins: { sourdaw: plugin },
                        rules: { [`sourdaw/${fixture.rule}`]: 'error' },
                    },
                    { filename: resolve(fixture.filename) }
                );
            expect(
                lint(fixture.invalid).map((message) => message.messageId),
                fixture.rule
            ).toEqual([fixture.messageId]);
            expect(lint(fixture.valid), fixture.rule).toEqual([]);
        }
    });
});
