import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleSendPreFader } from '../toggleSendPreFader';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    engineSetSend: vi.fn(),
}));

vi.mock('../../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Routing/useCases', () => ({
    setSend: mocks.engineSetSend,
}));

describe('toggleSendPreFader', () => {
    beforeEach(() => vi.clearAllMocks());

    it('preserves ordinary pre-fader toggling', () => {
        mocks.getTrackById.mockReturnValue({
            id: 'audio-1',
            kind: 'audio',
            sends: [{ busId: 'bus-1', level: 0.5, preFader: false }],
        });

        toggleSendPreFader('audio-1', 'bus-1');

        expect(mocks.updateTrack).toHaveBeenCalledWith('audio-1', expect.any(Function));
        expect(mocks.engineSetSend).toHaveBeenCalledWith('audio-1', 'bus-1', 0.5, true);

        // Invoke the captured updater to exercise the per-send map: the matched
        // send flips preFader while sibling sends pass through unchanged.
        const updater = mocks.updateTrack.mock.calls[0]![1] as (track: {
            sends: { busId: string; level: number; preFader: boolean }[];
        }) => { sends: { busId: string; level: number; preFader: boolean }[] };
        const result = updater({
            sends: [
                { busId: 'bus-2', level: 0.3, preFader: false },
                { busId: 'bus-1', level: 0.5, preFader: false },
            ],
        });
        expect(result.sends).toEqual([
            { busId: 'bus-2', level: 0.3, preFader: false },
            { busId: 'bus-1', level: 0.5, preFader: true },
        ]);
    });

    it('rejects dormant VCA send toggles before project or engine work', () => {
        mocks.getTrackById.mockReturnValue({
            id: 'vca-1',
            kind: 'vca',
            sends: [{ busId: 'bus-1', level: 0.5, preFader: false }],
        });

        toggleSendPreFader('vca-1', 'bus-1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
    });

    it('rejects a toggle whose resolved destination is a dormant VCA', () => {
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === 'audio-1') {
                return {
                    id: 'audio-1',
                    kind: 'audio',
                    sends: [{ busId: 'vca-1', level: 0.5, preFader: false }],
                };
            }
            return { id: 'vca-1', kind: 'vca', sends: [] };
        });

        toggleSendPreFader('audio-1', 'vca-1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
    });

    it('no-ops when the source track does not exist', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        toggleSendPreFader('missing', 'bus-1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
    });

    it('no-ops when the track has no send targeting that bus', () => {
        mocks.getTrackById.mockReturnValue({
            id: 'audio-1',
            kind: 'audio',
            sends: [{ busId: 'bus-2', level: 0.5, preFader: false }],
        });

        toggleSendPreFader('audio-1', 'bus-1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
    });
});
