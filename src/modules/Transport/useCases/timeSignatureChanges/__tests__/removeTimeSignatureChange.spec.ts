import { describe, it, expect } from 'vitest';

import * as subject from '../removeTimeSignatureChange';

describe('removeTimeSignatureChange', () => {
    it('should export removeTimeSignatureChange', () => {
        expect(subject.removeTimeSignatureChange).toBeDefined();
        const time = typeof subject.removeTimeSignatureChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
