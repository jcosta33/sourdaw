import { describe, it, expect } from 'vitest';

import * as subject from '../toggleSendPreFader';

describe('toggleSendPreFader', () => {
    it('should export toggleSendPreFader', () => {
        expect(subject.toggleSendPreFader).toBeDefined();
        const time = typeof subject.toggleSendPreFader;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
