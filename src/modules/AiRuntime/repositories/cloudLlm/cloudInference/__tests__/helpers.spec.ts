import { describe, it, expect } from 'vitest';

import { CLOUD_MODEL } from '../helpers';

describe('cloudInference helpers', () => {
    it('exports CLOUD_MODEL constant', () => {
        expect(typeof CLOUD_MODEL).toBe('string');
        expect(CLOUD_MODEL.length).toBeGreaterThan(0);
        expect(CLOUD_MODEL).toContain('claude');
    });
});
