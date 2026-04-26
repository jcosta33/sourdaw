import { describe, it, expect } from 'vitest';

import * as subject from '../revertAction';

describe('revertAction', () => {
    it('should export revertAction', () => {
        expect(subject.revertAction).toBeDefined();
        const time = typeof subject.revertAction;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
