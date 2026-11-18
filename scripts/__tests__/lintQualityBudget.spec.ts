import { describe, expect, it } from 'vitest';

import {
    findQualityBudgetGrowth,
    parseQualityBudget,
    parseQualityReport,
    reconcileQualityBudget,
} from '../lintQualityBudget';

const root = '/quality-fixture';
const file = 'src/example.ts';
const rule = 'sourdaw-craft/no-useless-clone-spread';
const otherRule = 'sourdaw-craft/no-long-array-chain';
const existing = parseQualityBudget(JSON.stringify({ [file]: { [rule]: { count: 1 } } }));
const clone = {
    filename: file,
    code: 'sourdaw-craft(no-useless-clone-spread)',
    message: 'Do not clone with spread.',
    severity: 'error',
    labels: [{ span: { line: 1, column: 5 } }],
};

function verdict(diagnostics: object[], selected?: string[]) {
    const report = parseQualityReport(JSON.stringify({ number_of_files: 2, diagnostics }), root);
    return reconcileQualityBudget(report, existing, selected, root);
}

describe('lint quality budget', () => {
    it('admits the exact count and keeps further real diagnostics', () => {
        expect(verdict([clone])).toEqual({ failed: false, hadErrors: true, diagnostics: [] });
        expect(verdict([clone, clone])).toEqual({
            failed: true,
            hadErrors: true,
            diagnostics: [
                'src/example.ts:1:5: error (sourdaw-craft/no-useless-clone-spread): Do not clone with spread.',
                'src/example.ts:1:5: error (sourdaw-craft/no-useless-clone-spread): Do not clone with spread.',
            ],
        });
    });

    it('admits one legacy complexity finding and refuses a second function over the cap', () => {
        const complexity = { ...clone, code: 'eslint(complexity)', message: 'Function complexity is 13.' };
        const budget = parseQualityBudget(JSON.stringify({ [file]: { 'eslint/complexity': { count: 1 } } }));
        const check = (diagnostics: object[]) =>
            reconcileQualityBudget(
                parseQualityReport(JSON.stringify({ number_of_files: 1, diagnostics }), root),
                budget,
                [file],
                root
            );

        expect(check([complexity]).failed).toBe(false);
        expect(
            check([complexity, { ...complexity, message: 'Another function has complexity 13.' }]).diagnostics
        ).toEqual([
            `${file}:1:5: error (eslint/complexity): Function complexity is 13.`,
            `${file}:1:5: error (eslint/complexity): Another function has complexity 13.`,
        ]);
        expect(check([]).diagnostics).toEqual([
            `${file}: stale eslint/complexity budget in oxlint-quality-baseline.json (1 recorded, 0 observed). Shrink or remove the count.`,
        ]);
    });

    it('does not spend a budget on a different file, rule, or parse error', () => {
        const verdictForMixed = verdict([
            clone,
            { ...clone, filename: 'src/another.ts' },
            { ...clone, code: 'sourdaw-craft(no-long-array-chain)' },
            { filename: file, message: 'Unexpected token.', severity: 'error' },
        ]);
        expect(verdictForMixed.failed).toBe(true);
        expect(verdictForMixed.diagnostics).toHaveLength(3);
        expect(verdictForMixed.diagnostics).toContain('src/example.ts: error: Unexpected token.');
    });

    it('requires explicit pruning only when the recorded path is in the selected scope', () => {
        expect(verdict([], ['src/other.ts']).failed).toBe(false);
        expect(verdict([], [file]).diagnostics).toEqual([
            'src/example.ts: stale sourdaw-craft/no-useless-clone-spread budget in oxlint-quality-baseline.json (1 recorded, 0 observed). Shrink or remove the count.',
        ]);
        expect(verdict([], ['src']).failed).toBe(true);
        expect(verdict([], ['src/*.ts']).failed).toBe(true);
        expect(verdict([], ['/quality-fixture/src/example.ts']).failed).toBe(true);
        expect(verdict([]).failed).toBe(true);
    });

    it.each([
        'bad json',
        null,
        { '/src/example.ts': { [rule]: { count: 1 } } },
        { 'src/../example.ts': { [rule]: { count: 1 } } },
        { [file]: {} },
        { [file]: { 'some/other-rule': { count: 1 } } },
        { [file]: { [rule]: { count: 0 } } },
        { [file]: { [rule]: { count: 1.5 } } },
        { [file]: { [rule]: { count: 2, reason: 'unused' } } },
    ])('refuses malformed budget %j', (value) => {
        expect(() => parseQualityBudget(typeof value === 'string' ? value : JSON.stringify(value))).toThrow(
            'oxlint-quality-baseline.json'
        );
    });

    it('allows a shrink and refuses a new path, new rule, or raised count', () => {
        const larger = parseQualityBudget(
            JSON.stringify({
                [file]: { [rule]: { count: 2 }, [otherRule]: { count: 1 } },
                'src/fresh.ts': { [rule]: { count: 1 } },
            })
        );
        expect(findQualityBudgetGrowth(larger, existing)).toEqual([]);
        expect(findQualityBudgetGrowth(existing, larger)).toEqual([
            'src/example.ts: sourdaw-craft/no-useless-clone-spread budget increased from 1 to 2 in oxlint-quality-baseline.json.',
            'src/example.ts: sourdaw-craft/no-long-array-chain budget increased from 0 to 1 in oxlint-quality-baseline.json.',
            'src/fresh.ts: sourdaw-craft/no-useless-clone-spread budget increased from 0 to 1 in oxlint-quality-baseline.json.',
        ]);
    });

    it('refuses malformed or truncated Oxlint JSON output', () => {
        expect(() => parseQualityReport('Failed to load configuration.', root)).toThrow('Oxlint quality report');
        expect(() => parseQualityReport('{"diagnostics":[]}', root)).toThrow('Oxlint quality report');
        expect(() => parseQualityReport('{"number_of_files":1,"diagnostics":[{}]}', root)).toThrow(
            'Oxlint quality report'
        );
        const loweredSeverity = JSON.stringify({
            number_of_files: 1,
            diagnostics: [{ ...clone, severity: 'warning' }],
        });
        expect(() => parseQualityReport(loweredSeverity, root)).toThrow('reported unexpected severity warning');
    });
});
