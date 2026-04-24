import { describe, it, expect } from 'vitest';

import * as subject from '../getSoundLock';

describe('getSoundLock', () => {
    it('should export getSoundLock', () => {
        expect(subject.getSoundLock).toBeDefined();
        const time = typeof subject.getSoundLock;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
