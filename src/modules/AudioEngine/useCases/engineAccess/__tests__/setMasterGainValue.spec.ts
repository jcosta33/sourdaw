import { describe, it, expect } from 'vitest';
import * as subject from '../setMasterGainValue';

describe('setMasterGainValue', () => {
    it('should export setMasterGainValue', () => {
        expect(subject.setMasterGainValue).toBeDefined();
        const t = typeof subject.setMasterGainValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
