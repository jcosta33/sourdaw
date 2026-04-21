import { describe, it, expect } from 'vitest';

import * as subject from '../setBusGain';

describe('setBusGain', () => {
    it('should export setBusGain', () => {
        expect(subject.setBusGain).toBeDefined();
        const time = typeof subject.setBusGain;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
