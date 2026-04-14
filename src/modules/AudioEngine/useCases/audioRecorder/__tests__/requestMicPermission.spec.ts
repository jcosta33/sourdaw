import { describe, it, expect } from 'vitest';
import * as subject from '../requestMicPermission';

describe('requestMicPermission', () => {
    it('should export requestMicPermission', () => {
        expect(subject.requestMicPermission).toBeDefined();
        const t = typeof subject.requestMicPermission;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
