import { describe, it, expect } from 'vitest';
import { filterTemplates } from '../filterTemplates';

describe('filterTemplates', () => {
    it('should return an array of public templates', () => {
        const result = filterTemplates({});

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });
});
