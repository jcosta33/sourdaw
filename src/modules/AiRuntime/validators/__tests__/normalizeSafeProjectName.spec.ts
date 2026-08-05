import { describe, expect, it } from 'vitest';

import { normalizeSafeProjectName } from '../normalizeSafeProjectName';

describe('normalizeSafeProjectName', () => {
    it('returns null for non-string input', () => {
        expect(normalizeSafeProjectName(undefined)).toBeNull();
        expect(normalizeSafeProjectName(null)).toBeNull();
        expect(normalizeSafeProjectName(123)).toBeNull();
        expect(normalizeSafeProjectName({ name: 'x' })).toBeNull();
        expect(normalizeSafeProjectName(['x'])).toBeNull();
    });

    it('returns null for empty or whitespace-only strings', () => {
        expect(normalizeSafeProjectName('')).toBeNull();
        expect(normalizeSafeProjectName('   ')).toBeNull();
        expect(normalizeSafeProjectName('\t\n')).toBeNull();
    });

    it('returns null for names exceeding 120 characters', () => {
        const valid = 'a'.repeat(120);
        expect(normalizeSafeProjectName(valid)).toBe(valid);
        const tooLong = 'a'.repeat(121);
        expect(normalizeSafeProjectName(tooLong)).toBeNull();
    });

    it('trims surrounding whitespace from valid names', () => {
        expect(normalizeSafeProjectName('  My Project  ')).toBe('My Project');
    });

    it('rejects HTML-injection characters', () => {
        expect(normalizeSafeProjectName('name<script>')).toBeNull();
        expect(normalizeSafeProjectName('name>')).toBeNull();
        expect(normalizeSafeProjectName('a&b')).toBeNull();
    });

    it('rejects control characters (codepoints below 32) and DEL (127)', () => {
        expect(normalizeSafeProjectName('a\x00b')).toBeNull();
        expect(normalizeSafeProjectName('a\x1Fb')).toBeNull();
        expect(normalizeSafeProjectName('a\x7Fb')).toBeNull();
    });

    it('accepts names with spaces, hyphens, numbers, and unicode/emoji', () => {
        expect(normalizeSafeProjectName('My Project v2')).toBe('My Project v2');
        expect(normalizeSafeProjectName('café-münchen')).toBe('café-münchen');
        expect(normalizeSafeProjectName('🎼 Music')).toBe('🎼 Music');
    });

    it('accepts the boundary character counts', () => {
        // length 1 (after trim) is valid
        expect(normalizeSafeProjectName('x')).toBe('x');
        // length 120 is valid (boundary)
        const exact = 'b'.repeat(120);
        expect(normalizeSafeProjectName(exact)).toBe(exact);
    });
});
