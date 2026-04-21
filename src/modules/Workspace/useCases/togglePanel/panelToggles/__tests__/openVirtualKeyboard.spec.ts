import { describe, it, expect } from 'vitest';

import * as subject from '../openVirtualKeyboard';

describe('openVirtualKeyboard', () => {
    it('should export openVirtualKeyboard', () => {
        expect(subject.openVirtualKeyboard).toBeDefined();
        const time = typeof subject.openVirtualKeyboard;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
