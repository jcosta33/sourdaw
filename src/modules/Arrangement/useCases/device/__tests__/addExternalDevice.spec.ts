import { describe, it, expect } from 'vitest';

import * as subject from '../addExternalDevice';

describe('addExternalDevice', () => {
    it('should export addExternalDevice', () => {
        expect(subject.addExternalDevice).toBeDefined();
        const time = typeof subject.addExternalDevice;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
