import { describe, it, expect } from 'vitest';

import * as subject from '../swipeGroupComp';

describe('swipeGroupComp', () => {
    it('should export swipeGroupComp', () => {
        expect(subject.swipeGroupComp).toBeDefined();
        const time = typeof subject.swipeGroupComp;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
