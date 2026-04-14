import { describe, it, expect } from 'vitest';
import * as subject from '../startInputMonitoring';

describe('startInputMonitoring', () => {
    it('should export startInputMonitoring', () => {
        expect(subject.startInputMonitoring).toBeDefined();
        const t = typeof subject.startInputMonitoring;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
