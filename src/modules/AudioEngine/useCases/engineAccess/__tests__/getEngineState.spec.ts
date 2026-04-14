import { describe, it, expect } from 'vitest';
import * as subject from '../getEngineState';

describe('getEngineState', () => {
    it('should export getEngineState', () => {
        expect(subject.getEngineState).toBeDefined();
        const t = typeof subject.getEngineState;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
