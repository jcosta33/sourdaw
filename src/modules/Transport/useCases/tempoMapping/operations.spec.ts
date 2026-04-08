import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { estimateOnsetsFromClips, applyTempoMap } from './operations';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

const trackCell = vi.hoisted(() => ({
    value: null as { tracks: Array<{ kind: string; clips: Array<{ startBeat: number; endBeat: number }> }> } | null,
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: trackCell,
}));

describe('estimateOnsetsFromClips', () => {
    beforeEach(() => {
        trackCell.value = null;
    });

    it('should return empty list when track store is empty', () => {
        injectDependencies(estimateOnsetsFromClips, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, tempo: 120 })),
        });

        expect(estimateOnsetsFromClips()).toEqual([]);
    });

    it('should derive simulated onsets from midi clip spans', () => {
        trackCell.value = {
            tracks: [
                {
                    kind: 'midi',
                    clips: [{ startBeat: 0, endBeat: 2 }],
                },
            ],
        };

        injectDependencies(estimateOnsetsFromClips, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, tempo: 120 })),
        });

        const onsets = estimateOnsetsFromClips();

        expect(onsets.length).toBeGreaterThan(0);
        expect(onsets[0]).toBeLessThanOrEqual(onsets[onsets.length - 1]!);
    });
});

describe('applyTempoMap', () => {
    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(applyTempoMap, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        applyTempoMap({
            points: [],
            averageBpm: 128,
            minBpm: 120,
            maxBpm: 130,
            confidence: 0.85,
            totalBeats: 16,
        });

        expect(update).not.toHaveBeenCalled();
    });

    it('should set tempo from average BPM when positive', () => {
        const update = vi.fn();
        injectDependencies(applyTempoMap, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        applyTempoMap({
            points: [],
            averageBpm: 128.4,
            minBpm: 120,
            maxBpm: 130,
            confidence: 0.85,
            totalBeats: 16,
        });

        expect(update).toHaveBeenCalledWith({ tempo: 128 });
    });
});
