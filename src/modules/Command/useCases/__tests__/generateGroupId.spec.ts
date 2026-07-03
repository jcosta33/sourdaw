import { describe, expect, it } from 'vitest';

import { generateGroupId } from '../generateGroupId';

describe('generateGroupId', () => {
    it('should generate unique group ids with labels', () => {
        const alpha = generateGroupId('Batch A');
        const beta = generateGroupId('Batch B');

        expect(alpha.groupId).toMatch(/^group-[a-f0-9]{8}$/i);
        expect(beta.groupId).toMatch(/^group-[a-f0-9]{8}$/i);
        expect(alpha.groupId).not.toBe(beta.groupId);
        expect(alpha.groupLabel).toBe('Batch A');
        expect(beta.groupLabel).toBe('Batch B');
    });
});
