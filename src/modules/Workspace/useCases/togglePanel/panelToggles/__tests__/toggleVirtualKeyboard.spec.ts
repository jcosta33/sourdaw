import { describe, it, expect } from 'vitest';

import * as subject from '../toggleVirtualKeyboard';

describe('toggleVirtualKeyboard', () => {
    it('should export toggleVirtualKeyboard', () => {
        expect(subject.toggleVirtualKeyboard).toBeDefined();
        const t = typeof subject.toggleVirtualKeyboard;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
