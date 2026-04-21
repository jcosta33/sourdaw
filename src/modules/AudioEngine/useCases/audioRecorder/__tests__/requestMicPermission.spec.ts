import { describe, it, expect } from 'vitest';

import * as subject from '../requestMicPermission';

describe('requestMicPermission', () => {
    it('should export requestMicPermission', () => {
        expect(subject.requestMicPermission).toBeDefined();
        const time = typeof subject.requestMicPermission;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
