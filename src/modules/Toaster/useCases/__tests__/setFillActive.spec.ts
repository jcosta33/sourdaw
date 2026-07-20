import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

import { getSequencerPlaybackState } from '../getSequencerPlaybackState';
import { setFillActive } from '../setFillActive';

const { setWorkletFillActive } = vi.hoisted(() => ({ setWorkletFillActive: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getToasterDeviceControls: vi.fn(() => ({ setFillActive: setWorkletFillActive })),
}));

describe('setFillActive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('turns fill on for the given device without touching other devices', () => {
        setFillActive('dev-x', true);

        expect(getSequencerPlaybackState('dev-x').fillActive).toBe(true);
        expect(getSequencerPlaybackState('dev-y').fillActive).toBe(false);
    });

    it('turns fill back off for the given device', () => {
        setFillActive('dev-z', true);
        setFillActive('dev-z', false);

        expect(getSequencerPlaybackState('dev-z').fillActive).toBe(false);
    });

    it('updates the worklet condition state without disturbing queued hit timing', () => {
        const state = getSequencerPlaybackState('dev-queued');
        state.preScheduledStep = 3;

        setFillActive('dev-queued', true);

        expect(state.preScheduledStep).toBe(3);
        expect(getToasterDeviceControls).toHaveBeenCalledWith('dev-queued');
        expect(setWorkletFillActive).toHaveBeenCalledWith(true);
    });
});
