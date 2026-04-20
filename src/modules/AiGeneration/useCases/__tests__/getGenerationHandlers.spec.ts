import { describe, it, expect } from 'vitest';

import { handleApplyGroove } from '../../handlers/generation/handleApplyGroove';
import { handleGenerateDrumPattern } from '../../handlers/generation/handleGenerateDrumPattern';
import { getGenerationHandlers } from '../getGenerationHandlers';

describe('getGenerationHandlers', () => {
    it('returns a map of AI Generation action handlers', () => {
        const handlers = getGenerationHandlers();

        expect(handlers).toHaveProperty('generateDrumPattern');
        expect(handlers).toHaveProperty('generateMelody');
        expect(handlers).toHaveProperty('applyGroove');

        // Check that it's exporting the exact handlers we expect
        expect(handlers.generateDrumPattern).toBe(handleGenerateDrumPattern);
        expect(handlers.applyGroove).toBe(handleApplyGroove);
    });
});
