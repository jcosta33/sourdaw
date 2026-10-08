import { describe, expect, it } from 'vitest';

import { isPlaywrightCollected, isVitestCollected, specFilePattern } from '../vitestCollectionPatterns';

describe('runner-specific collection case semantics', () => {
    it('admits Playwright filename case variants while keeping Vitest case-sensitive', () => {
        const upper = 'tests/e2e/nested/fourth.TEST.ts';
        expect(isPlaywrightCollected(upper)).toBe(true);
        expect(isPlaywrightCollected('tests/e2e/nested/FIFTH.Spec.MJS')).toBe(true);
        expect(specFilePattern.test(upper)).toBe(false);
        expect(isVitestCollected('src/fourth.TEST.ts')).toBe(false);
    });

    it('applies Playwright glob ignore case-insensitively', () => {
        expect(isPlaywrightCollected('tests/e2e/__TESTS__/ignored.test.ts')).toBe(false);
        expect(isPlaywrightCollected('tests/e2e/nested/__TeStS__/ignored.SPEC.TSX')).toBe(false);
        expect(isPlaywrightCollected('tests/e2e/nested/case.test.ts')).toBe(true);
    });
});
