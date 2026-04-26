import { describe, it, expect } from 'vitest';

import * as subject from '../registerFactoryModels';

describe('registerFactoryModels', () => {
    it('should export registerFactoryModels', () => {
        expect(subject.registerFactoryModels).toBeDefined();
        const time = typeof subject.registerFactoryModels;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
