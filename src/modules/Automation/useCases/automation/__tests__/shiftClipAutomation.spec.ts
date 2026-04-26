import { describe, it, expect } from 'vitest';

import * as subject from '../shiftClipAutomation';

describe('shiftClipAutomation', () => {
    it('should export shiftClipAutomation', () => {
        expect(subject.shiftClipAutomation).toBeDefined();
        const time = typeof subject.shiftClipAutomation;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
