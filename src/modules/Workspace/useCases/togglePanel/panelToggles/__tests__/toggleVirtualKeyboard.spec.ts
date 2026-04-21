import { describe, it, expect } from 'vitest';

import * as subject from '../toggleVirtualKeyboard';

describe('toggleVirtualKeyboard', () => {
    it('should export toggleVirtualKeyboard', () => {
        expect(subject.toggleVirtualKeyboard).toBeDefined();
        const time = typeof subject.toggleVirtualKeyboard;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
