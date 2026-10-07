import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
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
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';
import { prepareTimelineMapStateRestore, prepareTimelineMapTimeOperation } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Take } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { stageRecordingTake } from '../../../useCases/recording/stageRecordingTake';
import { startRecording } from '../../../useCases/recording/startRecording';
import { stopRecording } from '../../../useCases/recording/stopRecording';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';

const TRACK_ID = 'track-midi';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function recordedClip(): Clip {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip) {
        throw new Error('Expected the committed recording clip');
    }
    return clip;
}

function passTake(name: string): Take {
    const take = takeLaneStore.value?.lanes[0]?.takes.find((candidate) => candidate.name === name);
    if (!take) {
        throw new Error(`Expected the ${name} pass`);
    }
    return take;
}

/**
 * Loop [8,16) recorded from beat 12 for two wraps, stopped at beat 24, exactly
 * as the playhead scheduler stages it: each wrap names the recording clip, the
 * loop slice, and how deep its pass sits in the media. `stopRecording` commits
 * the MIDI recording, placing the clip and rebasing the passes.
 */
async function recordInsideLoop(): Promise<void> {
    const [provisional] = startRecording(12);
    if (!provisional) {
        throw new Error('Expected a provisional recording clip');
    }
    for (const [name, sourceOffsetBeats] of [
        ['Take 2', 0],
        ['Take 3', 4],
    ] as const) {
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name,
            startBeat: 8,
            endBeat: 16,
            sourceOffsetBeats,
        });
    }
    await stopRecording(24);
    flushAutomergeStorageWrites();
}

async function dispatch(action: AppAction): Promise<void> {
    await executeAppAction(action);
    flushAutomergeStorageWrites();
}

async function comp(takeName: string): Promise<void> {
    await dispatch({
        type: 'setCompRegion',
        payload: { trackId: TRACK_ID, takeId: passTake(takeName).id, startBeat: 8, endBeat: 16 },
    });
}

/** What the track sounds: each fragment's span and the media beat it enters at. */
function resolvedComp(): { startBeat: number; endBeat: number; mediaBeat: number }[] {
    return resolveClipsWithComping(TRACK_ID, trackStore.value?.tracks[0]?.clips ?? []).map((fragment) => ({
        startBeat: fragment.startBeat,
        endBeat: fragment.endBeat,
        mediaBeat: fragment.midiOffsetBeats ?? 0,
    }));
}

async function undoOnce(): Promise<void> {
    await undo();
    flushAutomergeStorageWrites();
}

async function redoOnce(): Promise<void> {
    await redo();
    flushAutomergeStorageWrites();
}

/**
 * Pass 2 comped over the loop plays its own material, which begins 4 beats into
 * the media. Past the loop the clip plays its media as recorded: beat 16 sounds
 * what was captured there, 4 beats after the record point.
 */
const pass2Comped = [
    { startBeat: 8, endBeat: 16, mediaBeat: 4 },
    { startBeat: 16, endBeat: 24, mediaBeat: 4 },
];

describe('a loop recording begun inside the loop', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('loop recorded inside the loop integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTimeOperationDependencies(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        sessionStorage.removeItem('sourdaw-undo-session');
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits the clip at the loop start with its media kept on the record point', async () => {
        await recordInsideLoop();

        expect(recordedClip()).toMatchObject({ startBeat: 8, endBeat: 24, midiOffsetBeats: -4 });
        expect([passTake('Take 2').passStartBeats, passTake('Take 3').passStartBeats]).toEqual([0, -4]);
    });

    it('plays pass 2 across the whole loop from its own material', async () => {
        await recordInsideLoop();
        await comp('Take 3');

        expect(resolvedComp()).toEqual(pass2Comped);
    });

    it('plays pass 1 only from the record point', async () => {
        await recordInsideLoop();
        await comp('Take 2');

        expect(resolvedComp()).toEqual([
            { startBeat: 12, endBeat: 16, mediaBeat: 0 },
            { startBeat: 16, endBeat: 24, mediaBeat: 4 },
        ]);
    });

    it('shifts the whole comp left when time before it is deleted, and undoes and redoes exactly', async () => {
        await recordInsideLoop();
        await comp('Take 3');
        const past = undoHistoryStore.value?.past.length ?? 0;

        await dispatch({ type: 'deleteTime', payload: { startBeat: 0, endBeat: 4 } });
        expect(undoHistoryStore.value?.past).toHaveLength(past + 1);
        const shifted = [
            { startBeat: 4, endBeat: 12, mediaBeat: 4 },
            { startBeat: 12, endBeat: 20, mediaBeat: 4 },
        ];
        expect(resolvedComp()).toEqual(shifted);

        await undoOnce();
        expect(resolvedComp()).toEqual(pass2Comped);
        await redoOnce();
        expect(resolvedComp()).toEqual(shifted);
    });

    it('keeps pass 2 sounding across the loop when time after it is deleted, and undoes and redoes exactly', async () => {
        await recordInsideLoop();
        await comp('Take 3');
        const past = undoHistoryStore.value?.past.length ?? 0;

        await dispatch({ type: 'deleteTime', payload: { startBeat: 20, endBeat: 24 } });
        expect(undoHistoryStore.value?.past).toHaveLength(past + 1);
        const trimmed = [
            { startBeat: 8, endBeat: 16, mediaBeat: 4 },
            { startBeat: 16, endBeat: 20, mediaBeat: 4 },
        ];
        expect(resolvedComp()).toEqual(trimmed);

        await undoOnce();
        expect(resolvedComp()).toEqual(pass2Comped);
        await redoOnce();
        expect(resolvedComp()).toEqual(trimmed);
    });

    it('shifts pass 2 with content slipped inside the clip', async () => {
        await recordInsideLoop();
        await comp('Take 3');

        await dispatch({
            type: 'slipClipContent',
            payload: { clipId: recordedClip().id, clipType: 'midi', offset: -3 },
        });

        expect(resolvedComp()).toEqual([
            { startBeat: 8, endBeat: 16, mediaBeat: 5 },
            { startBeat: 16, endBeat: 24, mediaBeat: 5 },
        ]);
    });

    it('hides what a start trim hides of pass 2', async () => {
        await recordInsideLoop();
        await comp('Take 3');

        await dispatch({ type: 'trimClipStart', payload: { clipId: recordedClip().id, newStartBeat: 10 } });

        expect(resolvedComp()).toEqual([
            { startBeat: 10, endBeat: 16, mediaBeat: 6 },
            { startBeat: 16, endBeat: 24, mediaBeat: 4 },
        ]);
    });
});
