import { describe, it, expect } from 'vitest';
import * as subject from '../openVirtualKeyboard';

describe('openVirtualKeyboard', () => {
    it('should export openVirtualKeyboard', () => {
        expect(subject.openVirtualKeyboard).toBeDefined();
        const t = typeof subject.openVirtualKeyboard;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
