import { describe, it, expect } from 'vitest';

import { readBalancedObject } from '../readBalancedObject';

describe('readBalancedObject', () => {
    it('extracts a simple flat object', () => {
        const text = '{"a":1}';
        expect(readBalancedObject(text, 0)).toBe('{"a":1}');
    });

    it('extracts a nested object, returning the full balanced span', () => {
        const text = '{"a":{"b":2}}';
        expect(readBalancedObject(text, 0)).toBe('{"a":{"b":2}}');
    });

    it('starts mid-string and extracts only from the given offset', () => {
        const text = 'prefix {"x": true} suffix';
        expect(readBalancedObject(text, 7)).toBe('{"x": true}');
    });

    it('ignores braces inside string literals', () => {
        const text = '{"a":"{not a brace}"}';
        expect(readBalancedObject(text, 0)).toBe('{"a":"{not a brace}"}');
    });

    it('ignores braces inside escaped string characters', () => {
        // The inner \" is an escaped quote, so the string continues past it.
        const text = '{"a":"he said \\"{hello}\\""}';
        expect(readBalancedObject(text, 0)).toBe('{"a":"he said \\"{hello}\\""}');
    });

    it('handles arrays containing objects with braces', () => {
        const text = '{"list":[{"x":1},{"y":2}]}';
        expect(readBalancedObject(text, 0)).toBe('{"list":[{"x":1},{"y":2}]}');
    });

    it('returns null when the object never closes', () => {
        expect(readBalancedObject('{"a":1', 0)).toBeNull();
    });

    it('returns null when the start position is not an opening brace', () => {
        expect(readBalancedObject('not json', 0)).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(readBalancedObject('', 0)).toBeNull();
    });

    it('returns null when start is at or past the end of the string', () => {
        expect(readBalancedObject('abc', 3)).toBeNull();
        expect(readBalancedObject('abc', 99)).toBeNull();
    });

    it('returns null when a string with an escaped quote never closes', () => {
        // The backslash escapes the quote, so the string never terminates and the
        // object never closes.
        expect(readBalancedObject('{"a":"never \\"ends}', 0)).toBeNull();
    });

    it('handles an empty object', () => {
        expect(readBalancedObject('{}', 0)).toBe('{}');
    });

    it('extracts the first balanced object when multiple follow', () => {
        const text = '{"a":1} {"b":2}';
        expect(readBalancedObject(text, 0)).toBe('{"a":1}');
    });

    it('treats braces in single-quoted-like contexts as string content only within double quotes', () => {
        // A brace outside a string still counts toward depth.
        const text = '{"a":1}{not parsed}';
        expect(readBalancedObject(text, 0)).toBe('{"a":1}');
    });
});
