import { describe, it, expect } from 'vitest';

import * as subject from '../setVirtualKeyboardVelocity';

describe('setVirtualKeyboardVelocity', () => {
    it('should export setVirtualKeyboardVelocity', () => {
        expect(subject.setVirtualKeyboardVelocity).toBeDefined();
        const t = typeof subject.setVirtualKeyboardVelocity;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
