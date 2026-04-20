import { describe, it, expect } from 'vitest';

import * as subject from '../shiftClipAutomation';

describe('shiftClipAutomation', () => {
    it('should export shiftClipAutomation', () => {
        expect(subject.shiftClipAutomation).toBeDefined();
        const t = typeof subject.shiftClipAutomation;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
