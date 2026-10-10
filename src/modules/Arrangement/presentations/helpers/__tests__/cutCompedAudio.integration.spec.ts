import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, undo, redo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { tempoMapStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { type Track, trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { hitTestClip } from '../../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { handleCutTool } from '../timelineTools';

type Project = { tracks: { tracks: Track[] }; takeLanes: NonNullable<typeof takeLaneStore.value> };

describe('split comped audio #5048 active cut-tool splitClipWithUndo route', () => {
    let stopProjectionBridge: () => void;
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('5048 cut tool controlled diagnosis');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
    });
    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    it('preserves the right comp through real hit testing and cut-tool dispatch, undo and redo', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const clip = ClipDummy.create({
            id: 'source',
            startBeat: 2,
            endBeat: 8,
            audioBufferId: 'comp-source-buffer',
            audioOffsetSeconds: 0.5,
            audioOffsetBeats: 1,
        });
        const track = TrackDummy.create({ clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: 'track-1', ghostClips: [] });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'source',
                            name: 'Selected take',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 99,
                            sourceOffsetSeconds: 1,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        });
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 80,
        });
        flushAutomergeStorageWrites();
        const before = resolveClipsWithComping(track.id, track.clips);
        expect(
            before.map((candidate) => [candidate.startBeat, candidate.endBeat, candidate.audioOffsetSeconds])
        ).toEqual([[2, 8, 1.5]]);
        expect(hitTestClip(48, 10)).toMatchObject({ clipId: 'source', trackId: 'track-1' });
        expect(handleCutTool(48, 10, 4)).toBe(true);
        flushAutomergeStorageWrites();
        const raw = getCrdtDoc<Project>('root');
        const afterClips = trackStore.value?.tracks[0]?.clips;
        if (!raw || !afterClips) {
            throw new Error('cut fixture requires authoritative and projected clips');
        }
        const after = resolveClipsWithComping('track-1', afterClips);
        expect(raw.tracks.tracks[0]!.clips).toEqual(afterClips);
        expect(raw.takeLanes).toEqual(takeLaneStore.value);
        expect(afterClips.map((candidate) => [candidate.startBeat, candidate.endBeat])).toEqual([
            [2, 4],
            [4, 8],
        ]);
        expect(
            after.map((candidate) => [candidate.startBeat, candidate.endBeat, candidate.audioOffsetSeconds])
        ).toEqual([
            [2, 4, 1.5],
            [4, 8, 2.5],
        ]);
        const splitTakes = structuredClone(takeLaneStore.value);
        await undo();
        flushAutomergeStorageWrites();
        expect(resolveClipsWithComping('track-1', trackStore.value!.tracks[0]!.clips)).toEqual(before);
        expect(getCrdtDoc<Project>('root')!.takeLanes).toEqual(takeLaneStore.value);
        await redo();
        flushAutomergeStorageWrites();
        expect(resolveClipsWithComping('track-1', trackStore.value!.tracks[0]!.clips)).toEqual(after);
        expect(takeLaneStore.value).toEqual(splitTakes);
        expect(getCrdtDoc<Project>('root')!.takeLanes).toEqual(splitTakes);
    });
});
