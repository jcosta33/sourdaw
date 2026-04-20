import { describe, it, expect } from 'vitest';

import * as subject from '../selectClipWithFocus';

describe('selectClipWithFocus', () => {
    it('should export selectClipWithFocus', () => {
        expect(subject.selectClipWithFocus).toBeDefined();
        const t = typeof subject.selectClipWithFocus;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
