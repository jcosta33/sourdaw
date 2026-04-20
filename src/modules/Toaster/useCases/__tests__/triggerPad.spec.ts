import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';

import { triggerToasterPad } from '../triggerPad';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: vi.fn(() => []),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ensureTrackStrip: vi.fn(),
}));

describe('triggerToasterPad', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(ensureTrackStrip).mockClear();
    });

    it('does not touch the strip when no toaster track exists', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        triggerToasterPad(0, 100);

        expect(ensureTrackStrip).not.toHaveBeenCalled();
    });
});
