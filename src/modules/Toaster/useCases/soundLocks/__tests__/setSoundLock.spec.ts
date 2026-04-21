import { describe, it, expect } from 'vitest';

import * as subject from '../setSoundLock';

describe('setSoundLock', () => {
    it('should export setSoundLock', () => {
        expect(subject.setSoundLock).toBeDefined();
        const time = typeof subject.setSoundLock;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
