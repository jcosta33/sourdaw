import { describe, it, expect } from 'vitest';

import * as subject from '../getFinalFeatureHandlers';

describe('getFinalFeatureHandlers', () => {
    it('should export getFinalFeatureHandlers', () => {
        expect(subject.getFinalFeatureHandlers).toBeDefined();
        const time = typeof subject.getFinalFeatureHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
