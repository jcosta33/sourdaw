import { describe, it, expect } from 'vitest';

import * as subject from '../createResonanceDemo';

describe('createResonanceDemo', () => {
    it('should export demo1_TheCompleteMix', () => {
        expect(subject.demo1_TheCompleteMix).toBeDefined();
        const time = typeof subject.demo1_TheCompleteMix;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
