import { describe, it, expect } from 'vitest';

import * as subject from '../swipeGroupComp';

describe('swipeGroupComp', () => {
    it('should export swipeGroupComp', () => {
        expect(subject.swipeGroupComp).toBeDefined();
        const t = typeof subject.swipeGroupComp;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
