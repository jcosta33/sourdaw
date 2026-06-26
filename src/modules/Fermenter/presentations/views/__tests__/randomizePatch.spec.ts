import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENGINE_NAMES } from '../../../models/FermenterPatch';
import { randomizePatch } from '../FermenterPanel';

const SAMPLER_ENGINE_INDEX = ENGINE_NAMES.length - 1; // 6 — the Sampler engine

describe('randomizePatch', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('can select the Sampler engine (the highest engine index)', () => {
        // Math.random() near 1 drives every randomInt to its inclusive max.
        vi.spyOn(Math, 'random').mockReturnValue(0.999999);

        const patch = randomizePatch();

        expect(SAMPLER_ENGINE_INDEX).toBe(6);
        expect(patch.oscEngine).toBe(SAMPLER_ENGINE_INDEX);
    });

    it('never produces an engine index outside the valid range', () => {
        for (const value of [0, 0.25, 0.5, 0.75, 0.999999]) {
            vi.spyOn(Math, 'random').mockReturnValue(value);
            const patch = randomizePatch();
            expect(patch.oscEngine).toBeGreaterThanOrEqual(0);
            expect(patch.oscEngine).toBeLessThanOrEqual(SAMPLER_ENGINE_INDEX);
            vi.restoreAllMocks();
        }
    });
});
