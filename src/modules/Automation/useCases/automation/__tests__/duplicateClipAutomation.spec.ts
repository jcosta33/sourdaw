import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClipAutomation';

describe('duplicateClipAutomation', () => {
    it('should export duplicateClipAutomation', () => {
        expect(subject.duplicateClipAutomation).toBeDefined();
        const time = typeof subject.duplicateClipAutomation;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
