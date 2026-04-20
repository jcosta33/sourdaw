import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAllTracks, addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';

import { exportPatternToTimeline } from '../exportPatternToTimeline';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: vi.fn(),
    addClip: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addMidiNote: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    playheadPositionRef: { current: 0 },
}));

describe('exportPatternToTimeline', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not add clips when there are no tracks', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        exportPatternToTimeline();

        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
