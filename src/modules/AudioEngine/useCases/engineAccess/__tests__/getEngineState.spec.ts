import { describe, it, expect } from 'vitest';

import * as subject from '../getEngineState';

describe('getEngineState', () => {
    it('should export getEngineState', () => {
        expect(subject.getEngineState).toBeDefined();
        const time = typeof subject.getEngineState;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
