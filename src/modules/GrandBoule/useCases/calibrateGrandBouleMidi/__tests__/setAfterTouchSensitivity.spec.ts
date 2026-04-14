import { describe, it, expect } from 'vitest';
import * as subject from '../setAfterTouchSensitivity';

describe('setAfterTouchSensitivity', () => {
    it('should export setAfterTouchSensitivity', () => {
        expect(subject.setAfterTouchSensitivity).toBeDefined();
        const t = typeof subject.setAfterTouchSensitivity;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
