import { describe, it, expect } from 'vitest';
import * as subject from '../loadSamplesForInstrument';

describe('loadSamplesForInstrument', () => {
    it('should export loadSamplesForInstrument', () => {
        expect(subject.loadSamplesForInstrument).toBeDefined();
        const t = typeof subject.loadSamplesForInstrument;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
