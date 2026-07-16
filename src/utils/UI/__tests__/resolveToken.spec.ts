import { describe, it, expect } from 'vitest';

import { resolveToken } from '../resolveToken';

describe('resolveToken', () => {
    it('returns fallback for unresolvable token', () => {
        const result = resolveToken('--nonexistent-token', '#333333');
        expect(result).toBe('#333333');
    });
    it('returns fallback when CSS var not set', () => {
        const result = resolveToken('--another-missing', '#ff0000');
        expect(result).toBe('#ff0000');
    });
    it('returns a string for any input', () => {
        const result = resolveToken('--test', '#000000');
        expect(typeof result).toBe('string');
    });
});
