import { describe, it, expect } from 'vitest';

import * as subject from '../setPadEngineImmediate';

describe('setPadEngineImmediate', () => {
    it('should export setPadEngineImmediate', () => {
        expect(subject.setPadEngineImmediate).toBeDefined();
        const t = typeof subject.setPadEngineImmediate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
