import { describe, it, expect } from 'vitest';

import * as subject from '../setSoundLock';

describe('setSoundLock', () => {
    it('should export setSoundLock', () => {
        expect(subject.setSoundLock).toBeDefined();
        const t = typeof subject.setSoundLock;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
