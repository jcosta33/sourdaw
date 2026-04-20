import { describe, it, expect } from 'vitest';

import * as subject from '../registerFactoryModels';

describe('registerFactoryModels', () => {
    it('should export registerFactoryModels', () => {
        expect(subject.registerFactoryModels).toBeDefined();
        const t = typeof subject.registerFactoryModels;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
