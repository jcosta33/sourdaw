import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { toggleInputMonitoring } from '../toggleInputMonitoring';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    startInputMonitoring: mocks.startInputMonitoring,
    stopInputMonitoring: mocks.stopInputMonitoring,
}));

describe('toggleInputMonitoring', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should do nothing when the track does not exist', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        toggleInputMonitoring('missing');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('should turn monitoring on and start the engine path when currently off', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            inputMonitoring: 'off',
        } as unknown as Track);

        toggleInputMonitoring('t1');

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { inputMonitoring: string; id: string }) => {
            inputMonitoring: string;
            id: string;
        };
        expect(patch({ inputMonitoring: 'off', id: 't1' })).toEqual({ inputMonitoring: 'on', id: 't1' });

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1');
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('should turn monitoring off and stop the engine path when currently on', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            inputMonitoring: 'on',
        } as unknown as Track);

        toggleInputMonitoring('t1');

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { inputMonitoring: string; id: string }) => {
            inputMonitoring: string;
            id: string;
        };
        expect(patch({ inputMonitoring: 'on', id: 't1' })).toEqual({ inputMonitoring: 'off', id: 't1' });

        expect(mocks.stopInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });
});
