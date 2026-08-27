import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { getEnvelope, setAllEnvelopes, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { getWarpState, setWarpState, warpStates } from '../../../stores/warpStates';
import { setStretchMode } from '../../../useCases';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

// `undo()` reports a refused inverse through `notifyUser`; the desktop
// notification bus does not exist in this environment.
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

describe('handleDuplicateClip atomic integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setAllEnvelopes({});
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 4 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setAllEnvelopes({});
        warpStates.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits through a compensable atomic batch and undo removes the duplicate', async () => {
        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(2);
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1');
        expect(duplicated).toBeDefined();

        await undo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
    });

    it('carries the clip gain envelope onto the duplicate and drops it again on undo', async () => {
        setEnvelope('clip-1', {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: -6 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });

        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1');
        expect(duplicated).toBeDefined();
        // The copy owns an equivalent envelope under its own id; the source's is untouched.
        expect(getEnvelope(duplicated!.id)).toEqual({
            clipId: duplicated!.id,
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: -6 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });
        expect(getEnvelope('clip-1')?.clipId).toBe('clip-1');

        await undo();

        expect(getEnvelope(duplicated!.id)).toBeUndefined();
        expect(getEnvelope('clip-1')?.points).toHaveLength(2);
    });

    it('carries all three satellite kinds onto the duplicate and undoes it (issue #2317)', async () => {
        setEnvelope('clip-1', {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: -6 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });
        setWarpState('clip-1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [{ id: 'w1', originalBeat: 1, warpedBeat: 1.25 }],
        });
        automationStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { id: 'ap1', beat: 0, value: 0.5, curve: 'linear', tension: 0 },
                        { id: 'ap2', beat: 2, value: 1, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1')!;
        expect(duplicated).toBeDefined();
        // Envelope: re-keyed to the copy, own point objects.
        expect(getEnvelope(duplicated.id)).toEqual({
            clipId: duplicated.id,
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: -6 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });
        // Warp: cloned with its own marker objects.
        expect(getWarpState(duplicated.id)).toEqual({
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [{ id: 'w1', originalBeat: 1, warpedBeat: 1.25 }],
        });
        // Clip-scoped automation lane: one fresh lane keyed to the copy's id.
        const copyLanes = automationStore.value!.lanes.filter((lane) => lane.clipId === duplicated.id);
        expect(copyLanes).toHaveLength(1);
        expect(copyLanes[0]!.id).not.toBe('lane-1');
        expect(copyLanes[0]!.points).toEqual([
            { id: 'ap1', beat: 0, value: 0.5, curve: 'linear', tension: 0 },
            { id: 'ap2', beat: 2, value: 1, curve: 'linear', tension: 0 },
        ]);

        await undo();

        // The copy is gone with every satellite it carried; the source keeps its own.
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
        expect(getEnvelope(duplicated.id)).toBeUndefined();
        expect(warpStates.has(duplicated.id)).toBe(false);
        expect(automationStore.value!.lanes.filter((lane) => lane.clipId === duplicated.id)).toHaveLength(0);
        expect(getEnvelope('clip-1')?.points).toHaveLength(2);
        expect(getWarpState('clip-1')?.markers).toHaveLength(1);
        expect(automationStore.value!.lanes).toHaveLength(1);
        expect(automationStore.value!.lanes[0]!.id).toBe('lane-1');
    });

    it('still undoes the duplicate after a semantic no-op warp write on the copy', async () => {
        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        expect(result.status).toBe('committed');
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1')!;

        // Re-selecting the already-active stretch mode writes a map entry whose
        // value IS defaultWarpState — by the system's own definition
        // (hasNonDefaultWarpState) the copy still carries no warp state, so the
        // captured satellite guard must still match and undo must still run.
        setStretchMode(duplicated.id, 'repitch');
        expect(warpStates.has(duplicated.id)).toBe(true);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
    });
});
