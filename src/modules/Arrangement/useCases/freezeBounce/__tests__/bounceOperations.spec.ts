import { describe, it, expect } from 'vitest';

import * as subject from '../bounceOperations';

describe('bounceOperations', () => {
    it('should export bounceInPlace', () => {
        expect(subject.bounceInPlace).toBeDefined();
        const t = typeof subject.bounceInPlace;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export bounceSelection', () => {
        expect(subject.bounceSelection).toBeDefined();
        const t = typeof subject.bounceSelection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export bounceToNewTrack', () => {
        expect(subject.bounceToNewTrack).toBeDefined();
        const t = typeof subject.bounceToNewTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
