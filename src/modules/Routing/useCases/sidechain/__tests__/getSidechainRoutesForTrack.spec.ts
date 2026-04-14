import { describe, it, expect } from 'vitest';
import * as subject from '../getSidechainRoutesForTrack';

describe('getSidechainRoutesForTrack', () => {
    it('should export getSidechainRoutesForTrack', () => {
        expect(subject.getSidechainRoutesForTrack).toBeDefined();
        const t = typeof subject.getSidechainRoutesForTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
