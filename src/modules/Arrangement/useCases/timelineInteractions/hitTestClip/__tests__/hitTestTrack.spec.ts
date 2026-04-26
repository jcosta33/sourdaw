import { describe, it, expect } from 'vitest';

import * as subject from '../hitTestTrack';

describe('hitTestTrack', () => {
    it('should export hitTestTrack', () => {
        expect(subject.hitTestTrack).toBeDefined();
        const time = typeof subject.hitTestTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
