import { describe, expect, it, vi } from 'vitest';

import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { addTempoChange, addTimeSignatureChange } from '#/modules/Transport/useCases';

import { createCinematicTemplate } from '../cinematic';

vi.mock('../../templateHelpers/builder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../templateHelpers/builder')>()),
    finalizeTemplate: vi.fn(),
}));

describe('createCinematicTemplate', () => {
    it('replaces existing transport map entries with the cinematic maps', async () => {
        addTempoChange(24, 120);
        addTimeSignatureChange(24, 7, 8);

        await createCinematicTemplate();

        expect(tempoMapStore.value?.changes.map(({ beat, tempo, curve }) => ({ beat, tempo, curve }))).toEqual([
            { beat: 0, tempo: 90, curve: 'instant' },
            { beat: 88, tempo: 72, curve: 'linear' },
        ]);
        expect(
            timeSignatureMapStore.value?.changes.map(({ beat, numerator, denominator }) => ({
                beat,
                numerator,
                denominator,
            }))
        ).toEqual([
            { beat: 0, numerator: 4, denominator: 4 },
            { beat: 48, numerator: 6, denominator: 8 },
            { beat: 72, numerator: 4, denominator: 4 },
        ]);
    });
});
