import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
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
import { type MidiCC, type MidiNote, type MidiPitchBend } from '#/modules/MIDI/models/MidiNote';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { projectChannelBend, projectMidiClipPlayback } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';

/**
 * A start trim moves which part of a looped clip's material the clip shows; it
 * never moves the material that stays. A wrapping trim re-bases
 * `midiOffsetBeats`, so the clip's notes, controller rows and bend rows must
 * all take the one re-base or the pedal and the bend play against different
 * notes than before the trim.
 */

const CLIP_ID = 'clip-keys';
const LOOP_BEATS = 8;
const CLIP_END_BEAT = 24;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

// Note A sounds at content 1 under the pedal press (lift at 3); note B sounds at
// content 5 under the bend (centred again at 6.5).
const notes: MidiNote[] = [
    { id: 'note-a', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 },
    { id: 'note-b', pitch: 64, startBeat: 5, duration: 0.5, velocity: 100 },
];
const pedalRows: MidiCC[] = [
    { id: 'cc-down', controller: 64, value: 127, beat: 1, channel: 0 },
    { id: 'cc-up', controller: 64, value: 0, beat: 3, channel: 0 },
];
const bendRows: MidiPitchBend[] = [
    { id: 'pb-up', value: 4096, beat: 5, channel: 0 },
    { id: 'pb-centre', value: 0, beat: 6.5, channel: 0 },
];

function seedLoopedMidiClip(overrides: Partial<Clip> = {}): void {
    const clip = ClipDummy.create({
        id: CLIP_ID,
        trackId: 'track-1',
        type: 'midi',
        startBeat: 0,
        endBeat: CLIP_END_BEAT,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: LOOP_BEATS,
        ...overrides,
    });
    const track = TrackDummy.create({ id: 'track-1', kind: 'midi', clips: [clip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: { [CLIP_ID]: structuredClone(notes) },
        ccByClipId: { [CLIP_ID]: structuredClone(pedalRows) },
        pitchBendByClipId: { [CLIP_ID]: structuredClone(bendRows) },
    });
    flushAutomergeStorageWrites();
}

function readClip(): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === CLIP_ID);
    if (!found) {
        throw new Error(`Expected clip ${CLIP_ID} in the track store`);
    }
    return found;
}

async function dispatch(action: AppAction): Promise<void> {
    await executeAppAction(action);
    flushAutomergeStorageWrites();
}

function trimStart(newStartBeat: number): Promise<void> {
    return dispatch({ type: 'trimClipStart', payload: { clipId: CLIP_ID, newStartBeat } });
}

type Move = { beat: number; value: number };

type Sounding = {
    /** The beat each note starts on, in every loop pass the clip plays it. */
    noteBeats: number[];
    pedal: Move[];
    bend: Move[];
};

function byBeat(left: Move, right: Move): number {
    return left.beat - right.beat;
}

/** What the clip plays across its length: every loop pass of its notes and pedal rows, and its channel bend. */
function readSounding(): Sounding {
    const clip = readClip();
    const played = projectMidiClipPlayback({
        notes: midiStore.value?.notesByClipId[CLIP_ID] ?? [],
        controlChanges: midiStore.value?.ccByClipId[CLIP_ID] ?? [],
        clip: { ...clip, id: CLIP_ID },
    });
    const bend = projectChannelBend({
        clips: [
            {
                clip,
                controlChanges: midiStore.value?.ccByClipId[CLIP_ID] ?? [],
                pitchBends: midiStore.value?.pitchBendByClipId[CLIP_ID] ?? [],
            },
        ],
        frameAtBeat: (beat) => Math.round(beat * 1000),
    });
    return {
        noteBeats: played.notes.map((note) => note.startBeat).sort((left, right) => left - right),
        pedal: played.controlChanges.map((event) => ({ beat: event.beat, value: event.value })).sort(byBeat),
        bend: bend.map((point) => ({ beat: point.beat, value: point.value })).sort(byBeat),
    };
}

/** The value in force at `beat`: the last move at or before it, or rest before the first. */
function inForceAt(moves: readonly Move[], beat: number): number {
    return moves.findLast((move) => move.beat <= beat)?.value ?? 0;
}

const SAMPLE_STEP_BEATS = 0.25;

/** The pedal and the bend in force at each of `beats`, probed a quarter beat after it so a move on the beat has landed. */
function stateAfter(sounding: Sounding, beats: readonly number[]): { pedal: number[]; bend: number[] } {
    return {
        pedal: beats.map((beat) => inForceAt(sounding.pedal, beat + SAMPLE_STEP_BEATS)),
        bend: beats.map((beat) => inForceAt(sounding.bend, beat + SAMPLE_STEP_BEATS)),
    };
}

describe('trimming the start of a looped MIDI clip moves its controller and bend rows with its notes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('trim clip start controller rows integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
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
        midiStore.set(structuredClone(defaultMidiStoreState));
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('plays the pedal and the bend under the same notes after a trim that wraps the offset', async () => {
        seedLoopedMidiClip();
        const before = readSounding();
        // The notes the trimmed clip still plays: A at 17 under the pedal, B at 13 and 21 under the bend.
        const survivingNoteBeats = [13, 17, 21];
        const probeBeats = Array.from({ length: 14 }, (_, step) => 10 + step);
        const stateBefore = stateAfter(before, probeBeats);

        await trimStart(10);

        // 10 beats into an 8-beat loop: the offset wraps from 10 back to 2.
        expect(readClip().midiOffsetBeats).toBe(2);
        const after = readSounding();
        expect(after.noteBeats).toEqual(survivingNoteBeats);
        // A press under note A and a bend under note B, in force exactly where they were.
        expect(stateAfter(after, [17, 19, 13, 21, 14.5, 22.5]).pedal).toEqual([127, 0, 0, 0, 0, 0]);
        expect(stateAfter(after, [17, 19, 13, 21, 14.5, 22.5]).bend).toEqual([0, 0, 4096, 4096, 0, 0]);
        expect(stateAfter(after, probeBeats)).toEqual(stateBefore);
    });

    it('restores the exact rows through undo and again through redo', async () => {
        seedLoopedMidiClip();
        const stored = {
            notes: structuredClone(midiStore.value?.notesByClipId[CLIP_ID]),
            ccs: structuredClone(midiStore.value?.ccByClipId[CLIP_ID]),
            bends: structuredClone(midiStore.value?.pitchBendByClipId[CLIP_ID]),
        };

        await trimStart(10);
        const trimmed = {
            notes: structuredClone(midiStore.value?.notesByClipId[CLIP_ID]),
            ccs: structuredClone(midiStore.value?.ccByClipId[CLIP_ID]),
            bends: structuredClone(midiStore.value?.pitchBendByClipId[CLIP_ID]),
        };
        expect(trimmed).not.toEqual(stored);

        await undo();
        flushAutomergeStorageWrites();
        expect(readClip().startBeat).toBe(0);
        expect(readClip().midiOffsetBeats).toBe(0);
        expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(stored.notes);
        expect(midiStore.value?.ccByClipId[CLIP_ID]).toEqual(stored.ccs);
        expect(midiStore.value?.pitchBendByClipId[CLIP_ID]).toEqual(stored.bends);

        await redo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(trimmed.notes);
        expect(midiStore.value?.ccByClipId[CLIP_ID]).toEqual(trimmed.ccs);
        expect(midiStore.value?.pitchBendByClipId[CLIP_ID]).toEqual(trimmed.bends);
    });

    it('leaves every row where it was when the trim does not wrap the offset', async () => {
        seedLoopedMidiClip();
        const stored = {
            notes: structuredClone(midiStore.value?.notesByClipId[CLIP_ID]),
            ccs: structuredClone(midiStore.value?.ccByClipId[CLIP_ID]),
            bends: structuredClone(midiStore.value?.pitchBendByClipId[CLIP_ID]),
        };

        await trimStart(2);

        expect(readClip().midiOffsetBeats).toBe(2);
        expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(stored.notes);
        expect(midiStore.value?.ccByClipId[CLIP_ID]).toEqual(stored.ccs);
        expect(midiStore.value?.pitchBendByClipId[CLIP_ID]).toEqual(stored.bends);
    });
});
