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
import { admitRecordingMidiNoteOff } from '../../../useCases/recording/admitRecordingMidiNoteOff';
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

    it('retimes a planned pass end in place when a relocation ends that pass first', async () => {
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
            name: 'Planned pass 0',
            startBeat: 8,
            endBeat: 12,
            sourceOffsetBeats: 0,
            recordingPassIndex: 0,
        });
        const planned = passTake('Planned pass 0');
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: clip.id,
            name: 'Relocated pass 0',
            startBeat: 8,
            endBeat: 10.5,
            sourceOffsetBeats: 0,
            recordingPassIndex: 0,
            replacedTakeId: planned.id,
            nextPassStartBeat: 9,
        });

        const takes = takeLaneStore.value?.lanes[0]?.takes ?? [];
        expect(takes.filter((take) => take.sourceOffsetBeats !== undefined)).toEqual([{ ...planned, endBeat: 10.5 }]);
        expect(passTake('Take 1')).toMatchObject({ recordingPassIndex: 1 });
        expect(passTake('Take 1')).not.toHaveProperty('sourceOffsetBeats');
    });

    describe('with the loop edited while recording', () => {
        function recordFromLoopStart(): Clip {
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
            transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: true });
            return clip;
        }

        /** A wrap take as the scheduler stages it: its offset derived from the live loop. */
        function stageWrap(
            clip: Clip,
            pass: { name: string; startBeat: number; endBeat: number; sourceOffsetBeats: number; index: number }
        ): void {
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: pass.name,
                startBeat: pass.startBeat,
                endBeat: pass.endBeat,
                sourceOffsetBeats: pass.sourceOffsetBeats,
                recordingPassIndex: pass.index,
            });
        }

        function holdNote(beat: number, passIndex: number) {
            return admitRecordingMidiNoteOn({
                trackId: TRACK_ID,
                channel: 0,
                note: 60,
                velocity: 100,
                audioTime: 1,
                position: { beat, passIndex },
            });
        }

        function holdNoteOnset(beat: number, passIndex: number): number {
            const held = holdNote(beat, passIndex);
            if (!held) {
                throw new Error('Expected the recording to admit the note');
            }
            return held.onsetSourceBeat;
        }

        it('places a later pass on the edited loop its take is staged on', () => {
            const clip = recordFromLoopStart();
            transportStore.set({ ...transportStore.value!, loopEnd: 10 });

            // Pass 0 of the loop [8, 10) ends at 10, so pass 1 opens at source 2.
            expect(recordingMidiSourceBeatAt(clip.id, { beat: 9, passIndex: 1 })).toBe(3);
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 10, sourceOffsetBeats: 0, index: 0 });
            expect(holdNote(9, 1)).toMatchObject({ onsetSourceBeat: 3, onsetPassIndex: 1 });
            stageWrap(clip, { name: 'Pass 1', startBeat: 8, endBeat: 10, sourceOffsetBeats: 2, index: 1 });
            expect(passTake('Pass 1')).toMatchObject({ startBeat: 8, sourceOffsetBeats: 2 });
        });

        it('keeps a pass on one placement when the loop is edited inside it', async () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            const held = holdNote(9, 1);
            transportStore.set({ ...transportStore.value!, loopEnd: 10 });
            admitRecordingMidiNoteOff({ channel: 0, note: 60, audioTime: 1.25, position: { beat: 9.5, passIndex: 1 } });

            expect(held).toMatchObject({ onsetSourceBeat: 5, releaseSourceBeat: 5.5 });
            // The scheduler derives pass 1's offset from the shortened loop; the
            // pass itself opened at source 4 and its take must read it there.
            stageWrap(clip, { name: 'Pass 1', startBeat: 8, endBeat: 10, sourceOffsetBeats: 2, index: 1 });
            expect(passTake('Pass 1')).toMatchObject({ startBeat: 8, endBeat: 10, sourceOffsetBeats: 4 });
            // Pass 1 ran [8, 10) from source 4, so pass 2 opens at source 6.
            expect(recordingMidiSourceBeatAt(clip.id, { beat: 8.5, passIndex: 2 })).toBe(6.5);

            playheadWrapCountRef.current = 2;
            await stopRecording(9.5);
            flushAutomergeStorageWrites();
            expect(passTake('Take 1')).toMatchObject({ recordingPassIndex: 2, sourceOffsetBeats: 6 });
        });

        it('seals the stopped pass on the placement its notes were given when the loop start moves forward', async () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            const early = holdNoteOnset(8.5, 1);
            const held = holdNoteOnset(9, 1);
            transportStore.set({ ...transportStore.value!, loopStart: 9 });

            playheadWrapCountRef.current = 1;
            await stopRecording(10);
            flushAutomergeStorageWrites();
            const take = passTake('Take 1');
            expect(held).toBe(5);
            // Takes play a pass from the clip start; both notes sound where they were struck, inside the take.
            expect(clip.startBeat + held - take.sourceOffsetBeats!).toBe(9);
            expect(clip.startBeat + early - take.sourceOffsetBeats!).toBe(8.5);
            expect(take.startBeat).toBeLessThanOrEqual(8.5);
        });

        it('keeps the notes of a wrapped pass inside its take when the loop start moves forward', () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            const early = holdNoteOnset(8.5, 1);
            transportStore.set({ ...transportStore.value!, loopStart: 9 });
            stageWrap(clip, { name: 'Pass 1', startBeat: 9, endBeat: 12, sourceOffsetBeats: 5, index: 1 });

            const take = passTake('Pass 1');
            expect(clip.startBeat + early - take.sourceOffsetBeats!).toBe(8.5);
            expect(take.startBeat).toBeLessThanOrEqual(8.5);
        });

        it('opens a pass take where the pass began when the loop start moves back inside it', () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            expect(recordingMidiSourceBeatAt(clip.id, { beat: 9, passIndex: 1 })).toBe(5);

            transportStore.set({ ...transportStore.value!, loopStart: 6 });
            stageWrap(clip, { name: 'Pass 1', startBeat: 6, endBeat: 12, sourceOffsetBeats: 6, index: 1 });

            // Pass 1 entered at 8, so beat 9 still reads source 5 through its take.
            expect(passTake('Pass 1')).toMatchObject({ startBeat: 8, endBeat: 12, sourceOffsetBeats: 4 });
            // Pass 2 enters at the moved loop start, a pass length of four on.
            expect(recordingMidiSourceBeatAt(clip.id, { beat: 6, passIndex: 2 })).toBe(8);
        });

        it('reads a relocated pass through the take staged for it', () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: 'Relocated pass 0',
                startBeat: 8,
                endBeat: 10.5,
                sourceOffsetBeats: 0,
                recordingPassIndex: 0,
                replacedTakeId: passTake('Pass 0').id,
                nextPassStartBeat: 9,
            });
            const onset = holdNote(9.5, 1)?.onsetSourceBeat;

            stageWrap(clip, { name: 'Pass 1', startBeat: 8, endBeat: 12, sourceOffsetBeats: 4, index: 1 });

            const take = passTake('Pass 1');
            expect(onset).toBe(take.sourceOffsetBeats! + 9.5 - clip.startBeat);
        });

        function releaseNote(beat: number, passIndex: number): void {
            admitRecordingMidiNoteOff({ channel: 0, note: 60, audioTime: 2, position: { beat, passIndex } });
        }

        it('plays a comped pass a jump entered on the beats it was struck', async () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: 'Relocated pass 0',
                startBeat: 8,
                endBeat: 9,
                sourceOffsetBeats: 0,
                recordingPassIndex: 0,
                replacedTakeId: passTake('Pass 0').id,
                nextPassStartBeat: 10,
            });
            holdNote(10, 1);
            releaseNote(10.5, 1);

            playheadWrapCountRef.current = 1;
            await stopRecording(11.5);
            flushAutomergeStorageWrites();
            await compPass('Take 1');

            expect(heardPitches(8, 12)).toEqual([null, null, 60, null]);
        });

        it('plays a comped later pass of a recording begun inside the loop on the beats it was struck', async () => {
            transportStore.set({
                ...defaultTransportState,
                isLooping: true,
                loopStart: 8,
                loopEnd: 12,
                playheadPosition: 10,
            });
            const [clip] = startRecording(10);
            if (!clip) {
                throw new Error('Expected a provisional MIDI recording');
            }
            transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: true });
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            holdNote(11, 1);
            releaseNote(11.5, 1);

            playheadWrapCountRef.current = 1;
            await stopRecording(11.75);
            flushAutomergeStorageWrites();
            await compPass('Take 1');

            expect(heardPitches(10, 12)).toEqual([null, 60]);
        });

        it('seals a pass a jump entered where the jump landed', async () => {
            const clip = recordFromLoopStart();
            stageWrap(clip, { name: 'Pass 0', startBeat: 8, endBeat: 12, sourceOffsetBeats: 0, index: 0 });
            stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: 'Relocated pass 0',
                startBeat: 8,
                endBeat: 9,
                sourceOffsetBeats: 0,
                recordingPassIndex: 0,
                replacedTakeId: passTake('Pass 0').id,
                nextPassStartBeat: 10,
            });
            const held = holdNoteOnset(10.5, 1);

            playheadWrapCountRef.current = 1;
            await stopRecording(11);
            flushAutomergeStorageWrites();
            const take = passTake('Take 1');
            expect(take).toMatchObject({ startBeat: 10, endBeat: 11 });
            expect(clip.startBeat + held - take.sourceOffsetBeats!).toBe(10.5);
        });
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
