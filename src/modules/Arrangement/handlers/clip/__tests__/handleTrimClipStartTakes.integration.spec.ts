import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
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
import { createTake, createTakeLane, type Take } from '../../../models/TakeLane';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type TakeStart = Pick<Take, 'id' | 'startBeat' | 'sourceOffsetBeats'>;

function passTake(id: string, clipId: string, startBeat: number, endBeat: number, offsetBeats: number): Take {
    return { ...createTake(clipId, id, startBeat, endBeat, offsetBeats), id };
}

function seedLoopRecording(takes: Take[], clipStartBeat = 0): void {
    const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', startBeat: clipStartBeat, endBeat: 24 });
    const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    takeLaneStore.set({ lanes: [{ ...createTakeLane('track-1'), takes }] });
    flushAutomergeStorageWrites();
}

function readTakeStarts(): TakeStart[] {
    const takes = takeLaneStore.value?.lanes.flatMap((lane) => lane.takes) ?? [];
    return takes.map(({ id, startBeat, sourceOffsetBeats }) => ({ id, startBeat, sourceOffsetBeats }));
}

function readClipStart(): { startBeat: number | undefined; audioOffsetBeats: number | undefined } {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    return { startBeat: clip?.startBeat, audioOffsetBeats: clip?.audioOffsetBeats };
}

const loopPassesAsRecorded = (): Take[] => [
    passTake('pass-1', 'clip-1', 0, 4, 0),
    passTake('pass-2', 'clip-1', 0, 4, 4),
    { ...createTake('clip-1', 'manual', 0, 12), id: 'manual' },
];

describe('trimClipStart on a loop-recorded clip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('trim clip start takes integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('starts each pass at the new clip start and keeps the media it plays unchanged', async () => {
        seedLoopRecording(loopPassesAsRecorded());

        await executeAppAction({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 1 } });

        expect(readClipStart()).toEqual({ startBeat: 1, audioOffsetBeats: 1 });
        expect(readTakeStarts()).toEqual([
            { id: 'pass-1', startBeat: 1, sourceOffsetBeats: 1 },
            { id: 'pass-2', startBeat: 1, sourceOffsetBeats: 5 },
            { id: 'manual', startBeat: 0, sourceOffsetBeats: undefined },
        ]);
    });

    it('leaves a pass that began before the clip alone when the start is trimmed earlier', async () => {
        // Recording began at beat 12 inside loop [8,16), so pass 2 starts at the loop start.
        seedLoopRecording([passTake('pass-2', 'clip-1', 8, 16, 4)], 12);

        await executeAppAction({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 10 } });

        expect(readClipStart().startBeat).toBe(10);
        expect(readTakeStarts()).toEqual([{ id: 'pass-2', startBeat: 8, sourceOffsetBeats: 4 }]);
    });

    it('hides a pass that began before the clip up to a start trimmed later', async () => {
        seedLoopRecording([passTake('pass-2', 'clip-1', 8, 16, 4)], 12);

        await executeAppAction({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 14 } });

        expect(readTakeStarts()).toEqual([{ id: 'pass-2', startBeat: 14, sourceOffsetBeats: 10 }]);
    });

    it('restores the clip and every pass in one undo, and trims them again on redo', async () => {
        seedLoopRecording(loopPassesAsRecorded());
        await executeAppAction({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 1 } });

        await undo();

        expect(readClipStart()).toEqual({ startBeat: 0, audioOffsetBeats: 0 });
        expect(readTakeStarts()).toEqual([
            { id: 'pass-1', startBeat: 0, sourceOffsetBeats: 0 },
            { id: 'pass-2', startBeat: 0, sourceOffsetBeats: 4 },
            { id: 'manual', startBeat: 0, sourceOffsetBeats: undefined },
        ]);

        await redo();

        expect(readClipStart()).toEqual({ startBeat: 1, audioOffsetBeats: 1 });
        expect(readTakeStarts()).toEqual([
            { id: 'pass-1', startBeat: 1, sourceOffsetBeats: 1 },
            { id: 'pass-2', startBeat: 1, sourceOffsetBeats: 5 },
            { id: 'manual', startBeat: 0, sourceOffsetBeats: undefined },
        ]);
    });
});
