import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';

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
        const rawDuplicate = getCrdtDoc<{ tracks?: NonNullable<(typeof trackStore)['value']> }>(
            'root'
        )?.tracks?.tracks[0]?.clips.find((clip) => clip.id === duplicated!.id);
        for (const copy of [duplicated, rawDuplicate]) {
            expect(copy).toBeDefined();
            expect(Object.hasOwn(copy!, 'audioOffsetSeconds')).toBe(false);
            expect(Object.hasOwn(copy!, 'audioUnwrappedOffsetSeconds')).toBe(false);
            expect(Object.hasOwn(copy!, 'audioLoopStartSeconds')).toBe(false);
            expect(Object.hasOwn(copy!, 'audioLoopPassEntrySeconds')).toBe(false);
            expect(Object.hasOwn(copy!, 'audioLoopPassOriginBeat')).toBe(false);
        }

        await undo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
    });

    it('duplicates a trimmed stretched loop at another beat with the same physical entry and pass phase through undo and redo', async () => {
        const source = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            startBeat: 6,
            endBeat: 14,
            audioOffsetBeats: 99,
            audioOffsetSeconds: -0.25,
            audioUnwrappedOffsetSeconds: 3.5,
            audioLoopStartSeconds: 1.5,
            audioLoopPassEntrySeconds: 4.5,
            audioLoopPassOriginBeat: 4,
            loopOriginBeat: 2,
            loopEnabled: true,
            loopLength: 4,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        });
        const current = trackStore.value!;
        trackStore.set({
            ...current,
            tracks: [{ ...current.tracks[0]!, clips: [source] }],
        });

        const projectedClip = (clipId: string) => trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === clipId);
        const rawClip = (clipId: string) =>
            getCrdtDoc<{ tracks?: NonNullable<(typeof trackStore)['value']> }>('root')?.tracks?.tracks[0]?.clips.find(
                (clip) => clip.id === clipId
            );
        const sourceFields = {
            audioOffsetSeconds: -0.25,
            audioUnwrappedOffsetSeconds: 3.5,
            audioLoopStartSeconds: 1.5,
            audioLoopPassEntrySeconds: 4.5,
            loopEnabled: true,
            loopLength: 4,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        } as const;
        const expectSource = (persisted = true) => {
            for (const clip of persisted ? [projectedClip('clip-1'), rawClip('clip-1')] : [projectedClip('clip-1')]) {
                expect(clip).toMatchObject({
                    id: 'clip-1',
                    startBeat: 6,
                    endBeat: 14,
                    loopOriginBeat: 2,
                    audioLoopPassOriginBeat: 4,
                    ...sourceFields,
                });
            }
        };
        const expectCopy = () => {
            for (const clip of [projectedClip('copy-physical'), rawClip('copy-physical')]) {
                expect(clip).toMatchObject({
                    id: 'copy-physical',
                    startBeat: 20,
                    endBeat: 28,
                    loopOriginBeat: 16,
                    audioLoopPassOriginBeat: 18,
                    ...sourceFields,
                });
            }
            const copy = projectedClip('copy-physical')!;
            const secondsAtBeat = (beat: number) => (beat <= 12 ? beat / 2 : 6 + beat - 12);
            const windows = [20, 24].flatMap((iterationStartBeat) =>
                projectAudioLoopPassSegments({
                    clip: copy,
                    loopLengthBeats: 4,
                    iterationStartBeat,
                    iterationEndBeat: iterationStartBeat + 4,
                    stretchRatio: 2,
                    tempoAtClipStart: 60,
                    secondsAtBeat,
                }).map((part) => [iterationStartBeat + part.startOffsetBeats, part.sourceStartSeconds])
            );
            expect(windows).toEqual([
                [20, -0.25],
                [22, 4.5],
                [24, 1.5],
                [26, 4.5],
            ]);
        };

        expectSource(false);
        const duplicateResult = await executeAppActionBatch(
            [
                {
                    type: 'duplicateClipAt',
                    payload: {
                        clipId: 'clip-1',
                        targetClipId: 'copy-physical',
                        destinationTrackId: 'track-1',
                        startBeat: 20,
                    },
                },
            ],
            { source: 'manual' }
        );
        expect(duplicateResult.status, duplicateResult.status === 'rejected' ? duplicateResult.reason : undefined).toBe(
            'committed'
        );
        expectSource();
        expectCopy();

        await undo();
        expectSource();
        expect(projectedClip('copy-physical')).toBeUndefined();
        expect(rawClip('copy-physical')).toBeUndefined();
        await redo();
        expectSource();
        expectCopy();
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
            stretchMode: 'phase-vocoder',
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
            stretchMode: 'phase-vocoder',
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

        // Re-selecting the already-active stretch mode is a semantic no-op:
        // setWarpState stores default values as absent, so by the system's own
        // definition (hasNonDefaultWarpState) the copy still carries no warp
        // state, and the captured satellite guard must still match so undo runs.
        setStretchMode(duplicated.id, 'repitch');
        expect(warpStates.has(duplicated.id)).toBe(false);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
    });
});
