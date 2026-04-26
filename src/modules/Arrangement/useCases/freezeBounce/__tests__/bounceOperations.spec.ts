import { describe, it, expect } from 'vitest';

import * as subject from '../bounceOperations';

describe('bounceOperations', () => {
    it('should export bounceInPlace', () => {
        expect(subject.bounceInPlace).toBeDefined();
        const time = typeof subject.bounceInPlace;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export bounceSelection', () => {
        expect(subject.bounceSelection).toBeDefined();
        const time = typeof subject.bounceSelection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export bounceToNewTrack', () => {
        expect(subject.bounceToNewTrack).toBeDefined();
        const time = typeof subject.bounceToNewTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
