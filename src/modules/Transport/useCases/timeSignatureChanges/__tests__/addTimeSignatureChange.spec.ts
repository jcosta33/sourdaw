import { describe, it, expect } from 'vitest';

import * as subject from '../addTimeSignatureChange';

describe('addTimeSignatureChange', () => {
    it('should export addTimeSignatureChange', () => {
        expect(subject.addTimeSignatureChange).toBeDefined();
        const time = typeof subject.addTimeSignatureChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
