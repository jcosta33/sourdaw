import { describe, it, expect } from 'vitest';

import * as subject from '../setMasterGainValue';

describe('setMasterGainValue', () => {
    it('should export setMasterGainValue', () => {
        expect(subject.setMasterGainValue).toBeDefined();
        const time = typeof subject.setMasterGainValue;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
