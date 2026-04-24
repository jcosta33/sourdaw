import { describe, it, expect } from 'vitest';

import * as subject from '../setPadEngineImmediate';

describe('setPadEngineImmediate', () => {
    it('should export setPadEngineImmediate', () => {
        expect(subject.setPadEngineImmediate).toBeDefined();
        const time = typeof subject.setPadEngineImmediate;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
