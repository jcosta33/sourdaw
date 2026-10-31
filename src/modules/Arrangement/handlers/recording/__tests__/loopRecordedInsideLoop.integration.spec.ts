import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    isValidAutomationTimeStateRestorePlan,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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
import { midiStore } from '#/modules/MIDI/stores';
import {
    isValidMidiTimeStateRestorePlan,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { defaultTransportState, playheadWrapCountRef, transportStore } from '#/modules/Transport/stores';
import {
    isValidTimelineMapStateRestorePlan,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Take } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { admitRecordingMidiNoteOn } from '../../../useCases/recording/admitRecordingMidiNoteOn';
import { recordingMidiSourceBeatAt } from '../../../useCases/recording/recordingMidiSourceBeatAt';
import { stageRecordingTake } from '../../../useCases/recording/stageRecordingTake';
import { startRecording } from '../../../useCases/recording/startRecording';
import { stopRecording } from '../../../useCases/recording/stopRecording';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';

const TRACK_ID = 'track-midi';
const LOOP_START_BEAT = 8;
const LOOP_END_BEAT = 16;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function recordedClips(): Clip[] {
    return trackStore.value?.tracks[0]?.clips ?? [];
}

function recordedClip(): Clip {
    const clip = recordedClips()[0];
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

async function dispatch(action: AppAction): Promise<void> {
    await executeAppAction(action);
    flushAutomergeStorageWrites();
}

/**
 * Loop [8,16) recorded on a MIDI track from `recordPointBeat` for two wraps,
 * exactly as the playhead scheduler stages the passes, stopped at
 * `stopBeat`; `stopRecording` commits it. One note is then written on every
 * beat of the media, its pitch naming the beat, so what a comp plays reads as
 * the media beats it sounds.
 */
async function recordLoop(recordPointBeat: number, passDepths: readonly [number, number], stopBeat: number) {
    const [provisional] = startRecording(recordPointBeat);
    if (!provisional) {
        throw new Error('Expected a provisional recording clip');
    }
    for (const [name, sourceOffsetBeats] of [
        ['Take 2', passDepths[0]],
        ['Take 3', passDepths[1]],
    ] as const) {
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name,
            startBeat: LOOP_START_BEAT,
            endBeat: LOOP_END_BEAT,
            sourceOffsetBeats,
        });
    }
    await stopRecording(stopBeat);
    flushAutomergeStorageWrites();
    const mediaBeats = Array.from({ length: stopBeat - recordPointBeat }, (_, beat) => beat);
    await dispatch({
        type: 'addNotes',
        payload: {
            clipId: provisional.id,
            notes: mediaBeats.map((beat) => ({ pitch: 40 + beat, startBeat: beat, duration: 0.5, velocity: 100 })),
        },
    });
}

async function compPass(takeName: string): Promise<void> {
    await dispatch({
        type: 'setCompRegion',
        payload: {
            trackId: TRACK_ID,
            takeId: passTake(takeName).id,
            startBeat: LOOP_START_BEAT,
            endBeat: LOOP_END_BEAT,
        },
    });
}

/**
 * The pitch heard on each whole beat of [fromBeat, toBeat), or null where the
 * track sounds nothing: each resolved fragment sounds its clip's notes at
 * `fragment start + note start − fragment MIDI offset`, inside its own span.
 */
function heardPitches(fromBeat: number, toBeat: number): (number | null)[] {
    const fragments = resolveClipsWithComping(TRACK_ID, recordedClips());
    const heard: (number | null)[] = [];
    for (let beat = fromBeat; beat < toBeat; beat++) {
        const fragment = fragments.find((candidate) => candidate.startBeat <= beat && beat < candidate.endBeat);
        const note = (midiStore.value?.notesByClipId[fragment?.id ?? ''] ?? []).find(
            (candidate) =>
                fragment !== undefined &&
                fragment.startBeat + candidate.startBeat - (fragment.midiOffsetBeats ?? 0) === beat
        );
        heard.push(note?.pitch ?? null);
    }
    return heard;
}

describe('MIDI loop recordings', () => {
    beforeEach(() => {
        transportStore.set(defaultTransportState);
        playheadWrapCountRef.current = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('MIDI loop recording delete time integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setTimeOperationDependencies({
            savedRestorePlanValidators: {
                automation: isValidAutomationTimeStateRestorePlan,
                midi: isValidMidiTimeStateRestorePlan,
                timelineMap: isValidTimelineMapStateRestorePlan,
            },
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
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
        transportStore.set(defaultTransportState);
        playheadWrapCountRef.current = 0;
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

    describe('recorded with a run-up from beat 4', () => {
        // Pass 1 starts 4 beats into the media, pass 2 a loop later.
        const recordWithRunUp = () => recordLoop(4, [4, 12], 32);

        it('keeps a MIDI recording on its record point with no pass placed', async () => {
            await recordWithRunUp();

            expect(recordedClip()).toMatchObject({ startBeat: 4, endBeat: 32 });
            expect(recordedClip()).not.toHaveProperty('midiOffsetBeats');
            expect(passTake('Take 3')).not.toHaveProperty('passAnchorSeconds');
            expect(passTake('Take 3')).not.toHaveProperty('passDepthSeconds');
        });

        it('keeps the comped pass sounding its material when time inside the loop is deleted', async () => {
            await recordWithRunUp();
            await compPass('Take 3');
            const comped = heardPitches(LOOP_START_BEAT, LOOP_END_BEAT);
            expect(comped).not.toContain(null);

            await dispatch({ type: 'deleteTime', payload: { startBeat: 10, endBeat: 12 } });

            // What sounded from 12 now sounds from 10, through the end of the
            // comp. The fragment left of the cut keeps only the notes before
            // it, which a MIDI split has always done, so it is not read here.
            expect(heardPitches(10, 14)).toEqual(comped.slice(4));
        });

        it('keeps the comped pass sounding its material when time across its start is deleted', async () => {
            await recordWithRunUp();
            await compPass('Take 3');
            const comped = heardPitches(LOOP_START_BEAT, LOOP_END_BEAT);
            expect(comped).not.toContain(null);

            await dispatch({ type: 'deleteTime', payload: { startBeat: 2, endBeat: 10 } });

            // What sounded from 10 now sounds from 2.
            expect(heardPitches(2, 8)).toEqual(comped.slice(2));
        });
    });

    describe('begun inside the loop at beat 12', () => {
        // Pass 1 is the short lap from the record point, pass 2 starts 4 beats into the media.
        const recordInsideLoop = () => recordLoop(12, [0, 4], 24);

        it('keeps the clip on its record point with no negative media offset', async () => {
            await recordInsideLoop();

            expect(recordedClip()).toMatchObject({ startBeat: 12, endBeat: 24 });
            expect(recordedClip()).not.toHaveProperty('midiOffsetBeats');
        });

        it.each([
            { name: 'before the clip', startBeat: 9, endBeat: 11, clipStartBeat: 10 },
            { name: 'over its first bars', startBeat: 12, endBeat: 16, clipStartBeat: 12 },
        ])('accepts Delete Time $name and undoes it', async ({ startBeat, endBeat, clipStartBeat }) => {
            await recordInsideLoop();
            await compPass('Take 3');
            const past = undoHistoryStore.value?.past.length ?? 0;
            const recorded = structuredClone(recordedClip());

            await dispatch({ type: 'deleteTime', payload: { startBeat, endBeat } });

            expect(undoHistoryStore.value?.past).toHaveLength(past + 1);
            expect(recordedClip().startBeat).toBe(clipStartBeat);
            expect(recordedClip().endBeat).toBe(recorded.endBeat - (endBeat - startBeat));
            expect(heardPitches(clipStartBeat, clipStartBeat + 4)).not.toContain(null);

            await undo();
            flushAutomergeStorageWrites();
            expect(recordedClip()).toEqual(recorded);
        });
    });

    it('leaves a planned next pass open when Stop precedes its wrap', async () => {
        transportStore.set({
            ...defaultTransportState,
            isLooping: true,
            loopStart: 8,
            loopEnd: 12,
            playheadPosition: 8,
        });
        const [clip] = startRecording(8);
        if (!clip) {
            throw new Error('Expected a provisional MIDI recording');
        }
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: clip.id,
            name: 'Completed pass 0',
            startBeat: 8,
            endBeat: 12,
            sourceOffsetBeats: 0,
            recordingPassIndex: 0,
        });
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        await stopRecording(11);
        flushAutomergeStorageWrites();

        expect(passTake('Take 1')).toMatchObject({ recordingPassIndex: 1, endBeat: 11 });
        expect(passTake('Take 1')).not.toHaveProperty('sourceOffsetBeats');
    });

    it('leaves notes and takes unowned after an edit ends a pass without a wrap', () => {
        transportStore.set({
            ...defaultTransportState,
            isLooping: true,
            loopStart: 8,
            loopEnd: 12,
            playheadPosition: 8,
        });
        const [clip] = startRecording(8);
        if (!clip) {
            throw new Error('Expected a provisional MIDI recording');
        }
        const pass = (name: string, sourceOffsetBeats: number, recordingPassIndex: number, interruptsPass?: true) =>
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name,
                startBeat: 8,
                endBeat: 12,
                sourceOffsetBeats,
                recordingPassIndex,
                ...(interruptsPass ? { interruptsPass } : {}),
            });
        transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: true });
        const admit = (beat: number, passIndex: number) =>
            admitRecordingMidiNoteOn({
                trackId: TRACK_ID,
                channel: 0,
                note: 60,
                velocity: 100,
                audioTime: 1,
                position: { beat, passIndex },
            });
        pass('Planned pass 0', 0, 0);
        expect(admit(11.9, 0)).toMatchObject({ onsetPassIndex: 0 });

        // The edit cancels the seam the planned stage expected; the scheduler
        // stages the pass it ends as one more take.
        pass('Edited pass', 4, 1, true);
        pass('Next wrap', 8, 2);

        expect(passTake('Planned pass 0')).toMatchObject({ recordingPassIndex: 0 });
        expect(passTake('Edited pass')).not.toHaveProperty('recordingPassIndex');
        expect(passTake('Next wrap')).not.toHaveProperty('recordingPassIndex');
        expect(passTake('Take 1')).toMatchObject({ recordingPassIndex: 1 });
        // Later input is still placed in the source, so controller rows keep
        // their beat; only the note's pass is withheld.
        expect(recordingMidiSourceBeatAt(clip.id, { beat: 9, passIndex: 1 })).toBe(5);
        const unowned = admit(9, 1);
        expect(unowned).toMatchObject({ onsetSourceBeat: 5 });
        expect(unowned).not.toHaveProperty('onsetPassIndex');
    });

    it('keeps the open take available through a third wrap, then seals its fourth-pass phase', async () => {
        transportStore.set({
            ...defaultTransportState,
            isLooping: true,
            loopStart: 8,
            loopEnd: 12,
            playheadPosition: 8,
        });
        const [clip] = startRecording(8);
        if (!clip) {
            throw new Error('Expected a provisional MIDI recording');
        }
        for (const pass of [0, 1, 2] as const) {
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: `Completed pass ${pass}`,
                startBeat: 8,
                endBeat: 12,
                sourceOffsetBeats: pass * 4,
                recordingPassIndex: pass,
            });
        }
        expect(passTake('Take 1')).toMatchObject({ recordingPassIndex: 3 });
        expect(passTake('Take 1')).not.toHaveProperty('sourceOffsetBeats');

        transportStore.set({ ...transportStore.value!, isPlaying: true });
        playheadWrapCountRef.current = 3;
        await stopRecording(9.5);
        flushAutomergeStorageWrites();

        expect(passTake('Take 1')).toMatchObject({ recordingPassIndex: 3, sourceOffsetBeats: 12, endBeat: 9.5 });
    });
});
