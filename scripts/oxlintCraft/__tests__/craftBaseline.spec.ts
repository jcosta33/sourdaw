import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { canonicalQualityRule, QUALITY_CONFIG, qualityRuleIds } from '../../lintQualityBudget';

function readConfig(file: string): { ignorePatterns: string[]; rules: object; overrides: { rules?: object }[] } {
    const result = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
    if (result.error) {
        throw new Error(`Could not parse ${file}`);
    }
    return result.config as { ignorePatterns: string[]; rules: object; overrides: { rules?: object }[] };
}

describe('quality lint configuration', () => {
    it('keeps the native exclusions and layers only the three historical size rules', () => {
        const config = readConfig(QUALITY_CONFIG);
        const original = readConfig('.oxlintrc.json');
        const publicPlugins = readConfig('.oxlint-plugins.json');
        const ruleNames = (value: typeof config) =>
            [...Object.keys(value.rules), ...value.overrides.flatMap(({ rules }) => Object.keys(rules ?? {}))].map(
                canonicalQualityRule
            );
        const otherRules = new Set(ruleNames(original).concat(ruleNames(publicPlugins)));

        expect(config.ignorePatterns).toEqual(original.ignorePatterns);
        expect(ruleNames(config).toSorted()).toEqual(qualityRuleIds.toSorted());
        expect(
            Array.from(otherRules)
                .filter((name) => qualityRuleIds.some((rule) => rule === name))
                .sort()
        ).toEqual(['eslint/complexity', 'eslint/max-depth', 'eslint/max-lines-per-function']);
    });

    it('registers the real craft rules as known ESLint directive names without enabling them twice', async () => {
        const config = await new ESLint().calculateConfigForFile('tests/e2e/smoke.spec.ts');

        expect(config?.plugins?.['sourdaw-craft']?.rules?.['no-fixed-test-sleep']?.create).toBeTypeOf('function');
        expect(config?.rules).not.toHaveProperty('sourdaw-craft/no-fixed-test-sleep');
    });
});
