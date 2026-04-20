import { describe, it, expect } from 'vitest';

import * as subject from '../setGrandBouleMasterGain';

describe('setGrandBouleMasterGain', () => {
    it('should export setGrandBouleMasterGain', () => {
        expect(subject.setGrandBouleMasterGain).toBeDefined();
        const t = typeof subject.setGrandBouleMasterGain;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
