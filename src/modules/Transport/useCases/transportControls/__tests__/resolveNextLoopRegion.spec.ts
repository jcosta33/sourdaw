import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { resolveNextLoopRegion } from '../resolveNextLoopRegion';

describe('resolveNextLoopRegion', () => {
    beforeEach(() => {
        trackStore.set(defaultTrackState);
        timeSignatureMapStore.set({ changes: [] });
    });

    it.each([
        [4, 4, 4],
        [3, 4, 3],
        [7, 8, 3.5],
    ])('uses the first bar for an empty %i/%i arrangement', (numerator, denominator, endBeat) => {
        expect(
            resolveNextLoopRegion({
                ...defaultTransportState,
                timeSignatureNumerator: numerator,
                timeSignatureDenominator: denominator,
            })
        ).toEqual({ loopStart: 0, loopEnd: endBeat, isLooping: true });
    });

    it('truncates the first meter-defined bar at the next meter event', () => {
        timeSignatureMapStore.set({ changes: [{ id: 'three-four', beat: 3, numerator: 3, denominator: 4 }] });

        expect(resolveNextLoopRegion(defaultTransportState)).toEqual({
            loopStart: 0,
            loopEnd: 3,
            isLooping: true,
        });
    });

    it('uses the final arrangement clip end before a default bar', () => {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-loop', name: 'Loop', kind: 'audio' })],
        });
        expect(
            addClip({ id: 'clip-eight', trackId: 'track-loop', name: 'Eight', startBeat: 0, endBeat: 8, type: 'audio' })
        ).not.toBeNull();

        expect(resolveNextLoopRegion(defaultTransportState)).toEqual({
            loopStart: 0,
            loopEnd: 8,
            isLooping: true,
        });
    });

    it('preserves a valid custom region while enabling and every endpoint while disabling', () => {
        expect(
            resolveNextLoopRegion({ ...defaultTransportState, loopStart: 2, loopEnd: 10, isLooping: false })
        ).toEqual({ loopStart: 2, loopEnd: 10, isLooping: true });
        expect(resolveNextLoopRegion({ ...defaultTransportState, loopStart: 2, loopEnd: 10, isLooping: true })).toEqual(
            { loopStart: 2, loopEnd: 10, isLooping: false }
        );
    });
});
