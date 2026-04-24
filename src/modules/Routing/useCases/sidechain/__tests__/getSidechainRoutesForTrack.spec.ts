import { describe, it, expect } from 'vitest';

import * as subject from '../getSidechainRoutesForTrack';

describe('getSidechainRoutesForTrack', () => {
    it('should export getSidechainRoutesForTrack', () => {
        expect(subject.getSidechainRoutesForTrack).toBeDefined();
        const time = typeof subject.getSidechainRoutesForTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
