import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackOutput } from '../setTrackOutput';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    engineSetTrackOutput: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setTrackOutput: mocks.engineSetTrackOutput,
}));

describe('setTrackOutput', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should update the track output id in the store and notify the audio engine', () => {
        setTrackOutput('t1', 'bus-main');

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { outputId: string; id: string }) => {
            outputId: string;
            id: string;
        };
        expect(patch({ outputId: 'old', id: 't1' })).toEqual({ outputId: 'bus-main', id: 't1' });

        expect(mocks.engineSetTrackOutput).toHaveBeenCalledWith('t1', 'bus-main');
    });

    it('rejects dormant VCA output assignment before project or engine work', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca' });

        setTrackOutput('vca-1', 'bus-main');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
    });
});
vi.mock('#/modules/Arrangement/repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));
