import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { getFirstToasterDeviceId } from '../toasterParamBridge/getFirstToasterDeviceId';
import { setPadEngineImmediate } from '../toasterParamBridge/setPadEngineImmediate';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: vi.fn(() => []),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: vi.fn(),
}));

describe('getFirstToasterDeviceId', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when there are no tracks', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        expect(getFirstToasterDeviceId()).toBeNull();
    });
});

describe('setPadEngineImmediate', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(getTrackStrip).mockClear();
    });

    it('does not touch the strip when the device is not on any track', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        setPadEngineImmediate('unknown-device', 0, 0);

        expect(getTrackStrip).not.toHaveBeenCalled();
    });
});
