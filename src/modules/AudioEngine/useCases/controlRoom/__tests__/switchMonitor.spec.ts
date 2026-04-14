import { describe, it, expect } from 'vitest';
import * as subject from '../switchMonitor';

describe('switchMonitor', () => {
    it('should export switchMonitor', () => {
        expect(subject.switchMonitor).toBeDefined();
        const t = typeof subject.switchMonitor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
