import { describe, it, expect } from 'vitest';
import * as subject from '../stopInputMonitoring';

describe('stopInputMonitoring', () => {
    it('should export stopInputMonitoring', () => {
        expect(subject.stopInputMonitoring).toBeDefined();
        const t = typeof subject.stopInputMonitoring;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
