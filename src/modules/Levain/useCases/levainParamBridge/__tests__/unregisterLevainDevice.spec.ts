import { describe, it, expect } from 'vitest';

import * as subject from '../unregisterLevainDevice';

describe('unregisterLevainDevice', () => {
    it('should export unregisterLevainDevice', () => {
        expect(subject.unregisterLevainDevice).toBeDefined();
        const t = typeof subject.unregisterLevainDevice;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
