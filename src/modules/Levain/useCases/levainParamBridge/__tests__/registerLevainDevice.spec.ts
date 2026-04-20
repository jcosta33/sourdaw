import { describe, it, expect } from 'vitest';

import * as subject from '../registerLevainDevice';

describe('registerLevainDevice', () => {
    it('should export registerLevainDevice', () => {
        expect(subject.registerLevainDevice).toBeDefined();
        const t = typeof subject.registerLevainDevice;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
