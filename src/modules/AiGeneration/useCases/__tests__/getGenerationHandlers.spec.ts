import { describe, it, expect } from 'vitest';

import { handleGenerateDrumPattern } from '../../handlers/generation/handleGenerateDrumPattern';
import { getGenerationHandlers } from '../getGenerationHandlers';

describe('getGenerationHandlers', () => {
    it('returns a map of AI Generation action handlers', () => {
        const handlers = getGenerationHandlers();

        expect(handlers).toHaveProperty('generateDrumPattern');
        expect(handlers).toHaveProperty('generateMelody');
        expect(handlers).not.toHaveProperty('applyGroove');

        // Check that it's exporting the exact handlers we expect
        expect(handlers.generateDrumPattern).toBe(handleGenerateDrumPattern);
    });
});
