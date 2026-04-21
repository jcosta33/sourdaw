import { describe, it, expect } from 'vitest';

import * as subject from '../setVirtualKeyboardVelocity';

describe('setVirtualKeyboardVelocity', () => {
    it('should export setVirtualKeyboardVelocity', () => {
        expect(subject.setVirtualKeyboardVelocity).toBeDefined();
        const time = typeof subject.setVirtualKeyboardVelocity;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
