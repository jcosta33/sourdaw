import { describe, it, expect } from 'vitest';

import * as subject from '../getSoundLock';

describe('getSoundLock', () => {
    it('should export getSoundLock', () => {
        expect(subject.getSoundLock).toBeDefined();
        const t = typeof subject.getSoundLock;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
