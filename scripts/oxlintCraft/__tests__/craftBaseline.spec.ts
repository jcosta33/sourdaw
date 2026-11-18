import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { QUALITY_CONFIG, qualityRuleIds } from '../../lintQualityBudget';

function readConfig(file: string): { ignorePatterns: string[]; rules: object; overrides: { rules?: object }[] } {
    const result = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
    if (result.error) {
        throw new Error(`Could not parse ${file}`);
    }
    return result.config as { ignorePatterns: string[]; rules: object; overrides: { rules?: object }[] };
}

describe('quality lint configuration', () => {
    it('keeps the existing native file exclusions and assigns each budgeted ID to one dedicated pass', () => {
        const config = readConfig(QUALITY_CONFIG);
        const original = readConfig('.oxlintrc.json');
        const publicPlugins = readConfig('.oxlint-plugins.json');
        const ruleNames = (value: typeof config) => [
            ...Object.keys(value.rules),
            ...value.overrides.flatMap(({ rules }) => Object.keys(rules ?? {})),
        ];

        expect(config.ignorePatterns).toEqual(original.ignorePatterns);
        expect(ruleNames(config).toSorted()).toEqual(qualityRuleIds.toSorted());
        expect(
            [...ruleNames(original), ...ruleNames(publicPlugins)].filter((name) =>
                qualityRuleIds.some((rule) => rule === name)
            )
        ).toEqual([]);
    });

    it('registers the real craft rules as known ESLint directive names without enabling them twice', async () => {
        const config = await new ESLint().calculateConfigForFile('tests/e2e/smoke.spec.ts');

        expect(config?.plugins?.['sourdaw-craft']?.rules?.['no-fixed-test-sleep']?.create).toBeTypeOf('function');
        expect(config?.rules).not.toHaveProperty('sourdaw-craft/no-fixed-test-sleep');
    });
});
