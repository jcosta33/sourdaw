import { describe, it, expect } from 'vitest';

import * as subject from '../stopInputMonitoring';

describe('stopInputMonitoring', () => {
    it('should export stopInputMonitoring', () => {
        expect(subject.stopInputMonitoring).toBeDefined();
        const time = typeof subject.stopInputMonitoring;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
