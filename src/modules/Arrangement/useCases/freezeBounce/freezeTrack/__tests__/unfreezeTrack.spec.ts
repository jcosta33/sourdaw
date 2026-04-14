import { describe, it, expect } from 'vitest';
import * as subject from '../unfreezeTrack';

describe('unfreezeTrack', () => {
    it('should export unfreezeTrack', () => {
        expect(subject.unfreezeTrack).toBeDefined();
        const t = typeof subject.unfreezeTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
