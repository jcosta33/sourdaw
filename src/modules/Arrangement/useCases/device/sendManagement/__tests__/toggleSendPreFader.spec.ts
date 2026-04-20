import { describe, it, expect } from 'vitest';

import * as subject from '../toggleSendPreFader';

describe('toggleSendPreFader', () => {
    it('should export toggleSendPreFader', () => {
        expect(subject.toggleSendPreFader).toBeDefined();
        const t = typeof subject.toggleSendPreFader;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
