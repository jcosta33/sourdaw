import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export createFlushParam', () => {
        expect(subject.createFlushParam).toBeDefined();
        const t = typeof subject.createFlushParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export encodePatchValue', () => {
        expect(subject.encodePatchValue).toBeDefined();
        const t = typeof subject.encodePatchValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
