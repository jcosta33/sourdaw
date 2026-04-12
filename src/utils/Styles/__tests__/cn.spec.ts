import { describe, it, expect } from 'vitest';

import { cn } from '../cn';

describe('cn', () => {
    it('should merge class strings', () => {
        expect(cn('a', 'b')).toBe('a b');
    });

    it('should resolve tailwind conflicts with tailwind-merge', () => {
        expect(cn('p-2', 'p-4')).toBe('p-4');
    });

    it('should ignore falsy inputs', () => {
        expect(cn('base', false && 'x', 'end')).toBe('base end');
    });
});
