import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClipAutomation';

describe('duplicateClipAutomation', () => {
    it('should export duplicateClipAutomation', () => {
        expect(subject.duplicateClipAutomation).toBeDefined();
        const t = typeof subject.duplicateClipAutomation;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
