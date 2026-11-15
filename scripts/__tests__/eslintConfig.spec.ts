import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { configuredSourdawRules } from './helpers/configuredSourdawRules.ts';
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

    it('fails direct storage access in production TypeScript', async () => {
        const selectors = await restrictedSyntaxFor('src/app/bootstrap.ts');

        expect(selectors.severity).toBe(2);
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
        const sourdawRules = Object.keys(await configuredSourdawRules());

        expect(sourdawRules).toContain('no-type-assertion-escape');
        expect(sourdawRules.filter((name) => /tauri/i.test(name))).toEqual([]);
        expect(Object.keys(config.rules).filter((name) => /tauri/i.test(name))).toEqual([]);
        expect(readFileSync('.oxlintrc.json', 'utf8')).toContain('no-restricted-imports');
        expect(readFileSync('.oxlintrc.json', 'utf8')).not.toMatch(/tauri/i);
    });
});
