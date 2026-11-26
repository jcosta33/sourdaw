import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { defaultTransportState } from '../../../models/TransportState';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { resolveLoopEnableRegion } from '../resolveLoopEnableRegion';

describe('resolveLoopEnableRegion', () => {
    beforeEach(() => {
        trackStore.set(defaultTrackState);
        timeSignatureMapStore.set({ changes: [] });
    });

    it('names the first bar when the current region is empty', () => {
        expect(resolveLoopEnableRegion({ ...defaultTransportState, loopStart: 0, loopEnd: 0 })).toEqual({
            loopStart: 0,
            loopEnd: 4,
        });
    });

    it('names nothing when the current region can loop', () => {
        expect(resolveLoopEnableRegion({ ...defaultTransportState, loopStart: 4, loopEnd: 12 })).toBeNull();
    });

    it('names nothing while the loop is on or the state is unknown', () => {
        expect(
            resolveLoopEnableRegion({ ...defaultTransportState, loopStart: 0, loopEnd: 0, isLooping: true })
        ).toBeNull();
        expect(resolveLoopEnableRegion(null)).toBeNull();
    });
});
