import { describe, it, expect } from 'vitest';

import * as subject from '../hitTestTrack';

describe('hitTestTrack', () => {
    it('should export hitTestTrack', () => {
        expect(subject.hitTestTrack).toBeDefined();
        const t = typeof subject.hitTestTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
