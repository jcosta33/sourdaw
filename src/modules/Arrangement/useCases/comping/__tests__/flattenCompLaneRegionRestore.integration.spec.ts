import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { addClip } from '../../clip/addClip';
import { resolveClipsWithComping } from '../../resolveComping';
import { flattenComp } from '../flattenComp';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** The spans the resolver hands playback for a track's clips. */
function resolvedSpans(): [number, number][] {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip) {
        throw new Error('expected a live clip on the track');
    }
    return resolveClipsWithComping('track-1', [clip]).map((fragment) => [fragment.startBeat, fragment.endBeat]);
}

describe('flatten lane restore and its comp regions', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('flatten lane region restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('does not put back a region whose take the replay had to drop', async () => {
        // The lane's take names a clip the project no longer holds, and its region
        // comps that take over the span the track's own clip will occupy.
        const orphanTake = createTake('clip-gone', 'Gone take', 0, 4);
        takeLaneStore.set({
            lanes: [
                {
                    ...createTakeLane('track-1'),
                    takes: [orphanTake],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: orphanTake.id }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        // Flatten takes the lane-only route on a track with no clips, recording a lane
        // removal for undo.
        expect(flattenComp('track-1')).toBe(true);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        // A projection gives the track its clip back before the lane is restored.
        addClip({ id: 'clip-live', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Clip', type: 'audio' });
        flushAutomergeStorageWrites();

        await undo();

        const lane = takeLaneStore.value?.lanes[0];
        expect(lane?.takes).toEqual([]);
        // The take is gone from the replay, so its region must be gone with it: a
        // region naming a missing take advances the resolver's gap cursor over the
        // span and silences the track's own material there.
        expect(lane?.activeCompRegions).toEqual([]);
        expect(resolvedSpans()).toEqual([[0, 4]]);
    });
});
