import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type InputMonitoring } from '../../../models/Track';
import { INPUT_MONITORING_CYCLE, toggleInputMonitoring } from '../toggleInputMonitoring';

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

    it('exposes the canonical auto → on → off → auto cycle', () => {
        // This is the single source of truth shared with the TrackHeader button
        // so both entry points advance the state identically (finding #44).
        expect(INPUT_MONITORING_CYCLE).toEqual({ auto: 'on', on: 'off', off: 'auto' });
    });

    function advance(from: InputMonitoring): InputMonitoring {
        mocks.getTrackById.mockReturnValue({ id: 't1', inputMonitoring: from });
        toggleInputMonitoring('t1');
        const patch = mocks.updateTrack.mock.calls.at(-1)![1] as (t: { inputMonitoring: InputMonitoring }) => {
            inputMonitoring: InputMonitoring;
        };
        return patch({ inputMonitoring: from }).inputMonitoring;
    }

    it('advances auto → on and starts the engine path', () => {
        expect(advance('auto')).toBe('on');
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1');
        expect(mocks.stopInputMonitoring).not.toHaveBeenCalled();
    });

    it('advances on → off and stops the engine path', () => {
        expect(advance('on')).toBe('off');
        expect(mocks.stopInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('advances off → auto (does not skip auto) and stops the engine path', () => {
        // Previously this toggled off → on, skipping auto and diverging from the
        // TrackHeader button. Now it matches the shared cycle.
        expect(advance('off')).toBe('auto');
        expect(mocks.stopInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('normalizes dormant VCA monitoring residue to off without starting hardware monitoring', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca', inputMonitoring: 'auto' });

        toggleInputMonitoring('vca-1');

        const patch = mocks.updateTrack.mock.calls[0]![1] as (track: { inputMonitoring: InputMonitoring }) => {
            inputMonitoring: InputMonitoring;
        };
        expect(patch({ inputMonitoring: 'auto' }).inputMonitoring).toBe('off');
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        expect(mocks.stopInputMonitoring).toHaveBeenCalledTimes(1);
    });
});
