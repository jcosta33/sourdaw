import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { getEffectiveGain } from '#/modules/Arrangement/useCases';
import { setTrackGain } from '#/modules/AudioEngine/useCases';

import { applyVcaGains } from '../applyVcaGains';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getEffectiveGain: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    setTrackGain: vi.fn(),
}));

type MutableTrackStore = { value: { tracks: unknown[] } | null };

const mutableTrackStore = trackStore as unknown as MutableTrackStore;

describe('applyVcaGains', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing when the track store has no tracks snapshot', () => {
        mutableTrackStore.value = null;

        applyVcaGains();

        expect(getEffectiveGain).not.toHaveBeenCalled();
        expect(setTrackGain).not.toHaveBeenCalled();
    });

    it('skips tracks that are not part of a VCA group', () => {
        mutableTrackStore.value = {
            tracks: [{ id: 'track-1', vcaGroupId: undefined, muted: false, gain: 0.8 }],
        };

        applyVcaGains();

        expect(getEffectiveGain).not.toHaveBeenCalled();
        expect(setTrackGain).not.toHaveBeenCalled();
    });

    it('skips muted tracks even when they belong to a VCA group', () => {
        mutableTrackStore.value = {
            tracks: [{ id: 'track-1', vcaGroupId: 'vca-1', muted: true, gain: 0.8 }],
        };

        applyVcaGains();

        expect(getEffectiveGain).not.toHaveBeenCalled();
        expect(setTrackGain).not.toHaveBeenCalled();
    });

    it('applies the effective VCA-combined gain to the audio engine for an eligible track', () => {
        vi.mocked(getEffectiveGain).mockReturnValue(0.42);
        mutableTrackStore.value = {
            tracks: [{ id: 'track-1', vcaGroupId: 'vca-1', muted: false, gain: 0.8 }],
        };

        applyVcaGains();

        expect(getEffectiveGain).toHaveBeenCalledWith('track-1', 0.8);
        expect(setTrackGain).toHaveBeenCalledWith('track-1', 0.42);
    });

    it('processes every eligible track in the snapshot independently', () => {
        vi.mocked(getEffectiveGain).mockImplementation((_id, gain) => gain * 2);
        mutableTrackStore.value = {
            tracks: [
                { id: 'track-1', vcaGroupId: 'vca-1', muted: false, gain: 0.5 },
                { id: 'track-2', vcaGroupId: undefined, muted: false, gain: 0.9 },
                { id: 'track-3', vcaGroupId: 'vca-1', muted: false, gain: 0.25 },
            ],
        };

        applyVcaGains();

        expect(setTrackGain).toHaveBeenCalledTimes(2);
        expect(setTrackGain).toHaveBeenNthCalledWith(1, 'track-1', 1);
        expect(setTrackGain).toHaveBeenNthCalledWith(2, 'track-3', 0.5);
    });

    it('defers on a VCA-member track whose gain the automation path already composed and wrote this tick', () => {
        vi.mocked(getEffectiveGain).mockReturnValue(0.42);
        mutableTrackStore.value = {
            tracks: [{ id: 'track-1', vcaGroupId: 'vca-1', muted: false, gain: 0.8 }],
        };

        applyVcaGains(new Set(['track-1']));

        // applyAutomation already folded the VCA multiplier into its own write for
        // this track, so the VCA path must not issue a competing setTargetAtTime
        // (which our per-tick cancelScheduledValues would then erase).
        expect(getEffectiveGain).not.toHaveBeenCalled();
        expect(setTrackGain).not.toHaveBeenCalled();
    });
});
