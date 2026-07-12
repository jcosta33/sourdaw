import { describe, it, expect } from 'vitest';

import { setPadEngineImmediate } from '../setPadEngineImmediate';

describe('setPadEngineImmediate', () => {
    it('is a function', () => {
        expect(typeof setPadEngineImmediate).toBe('function');
    });
});
