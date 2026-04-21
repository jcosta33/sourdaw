import { describe, it, expect } from 'vitest';

import * as subject from '../startInputMonitoring';

describe('startInputMonitoring', () => {
    it('should export startInputMonitoring', () => {
        expect(subject.startInputMonitoring).toBeDefined();
        const time = typeof subject.startInputMonitoring;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
