import { describe, it, expect } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
    it('should merge class strings and resolve Tailwind conflicts', () => {
        expect(cn('px-2 py-1', 'px-4')).toMatch(/px-4/);
        expect(cn('px-2 py-1', 'px-4')).not.toMatch(/px-2/);
    });

    it('should handle conditional and array inputs', () => {
        expect(cn('base', false && 'hidden', ['flex', 'gap-2'])).toContain('base');
        expect(cn('base', false && 'hidden', ['flex', 'gap-2'])).toContain('flex');
    });
});
