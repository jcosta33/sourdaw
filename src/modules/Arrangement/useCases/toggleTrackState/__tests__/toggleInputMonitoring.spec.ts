import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type InputMonitoring, type Track } from '../../../models/Track';
import { INPUT_MONITORING_CYCLE, toggleInputMonitoring } from '../toggleInputMonitoring';

const inputTwoTrack = {
    id: 't1',
    kind: 'audio',
    inputMonitoring: 'auto',
    inputId: 'input-2',
} satisfies Pick<Track, 'id' | 'kind' | 'inputMonitoring' | 'inputId'>;

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
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
    stopTrackInputMonitoring: mocks.stopTrackInputMonitoring,
}));

describe('toggleInputMonitoring', () => {
    beforeEach(() => vi.resetAllMocks());

    it('should do nothing when the track does not exist', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        toggleInputMonitoring('missing');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
    });

    it('exposes the canonical auto → on → off → auto cycle', () => {
        // This is the single source of truth shared with the TrackHeader button
        // so both entry points advance the state identically (finding #44).
        expect(INPUT_MONITORING_CYCLE).toEqual({ auto: 'on', on: 'off', off: 'auto' });
    });

    function advance(from: InputMonitoring): InputMonitoring {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', inputMonitoring: from, inputId: 'input-2' });
        toggleInputMonitoring('t1');
        const patch = mocks.updateTrack.mock.calls.at(-1)![1] as (t: { inputMonitoring: InputMonitoring }) => {
            inputMonitoring: InputMonitoring;
        };
        return patch({ inputMonitoring: from }).inputMonitoring;
    }

    it('advances auto → on and starts the engine path', () => {
        expect(advance('auto')).toBe('on');
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'input-2');
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('advances on → off and stops that track’s listening edge only', () => {
        expect(advance('on')).toBe('off');
        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('t1');
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('advances off → auto (does not skip auto) and stops that track’s listening edge only', () => {
        // Previously this toggled off → on, skipping auto and diverging from the
        // TrackHeader button. Now it matches the shared cycle.
        expect(advance('off')).toBe('auto');
        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('t1');
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA toggle without writing or stopping another monitoring session', () => {
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === 'audio-1') {
                return { id: 'audio-1', kind: 'audio', inputMonitoring: 'auto', inputId: 'input-2' };
            }
            return { id: 'vca-1', kind: 'vca', inputMonitoring: 'auto' };
        });

        toggleInputMonitoring('audio-1');
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('audio-1', 'input-2');
        mocks.updateTrack.mockClear();
        mocks.startInputMonitoring.mockClear();

        toggleInputMonitoring('vca-1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
    });

    it('starts monitoring on the track’s own selected input when the toggle enables it', () => {
        mocks.getTrackById.mockReturnValue(inputTwoTrack);

        toggleInputMonitoring('t1');

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'input-2');
    });

    it('starts monitoring on the default capture when the track has no explicit selection', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', inputMonitoring: 'auto', inputId: null });

        toggleInputMonitoring('t1');

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', null);
    });
});
