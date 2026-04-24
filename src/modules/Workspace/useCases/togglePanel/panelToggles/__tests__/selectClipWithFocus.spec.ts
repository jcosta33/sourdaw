import { describe, it, expect } from 'vitest';

import * as subject from '../selectClipWithFocus';

describe('selectClipWithFocus', () => {
    it('should export selectClipWithFocus', () => {
        expect(subject.selectClipWithFocus).toBeDefined();
        const time = typeof subject.selectClipWithFocus;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
