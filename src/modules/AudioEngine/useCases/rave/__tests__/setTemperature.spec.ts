import { describe, it, expect } from 'vitest';

import * as subject from '../setTemperature';

describe('setTemperature', () => {
    it('should export setTemperature', () => {
        expect(subject.setTemperature).toBeDefined();
        const time = typeof subject.setTemperature;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
