import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectClipControllerEvents, projectClipMidiEvents } from '#/modules/MIDI/useCases';

import { exportMidiClip } from '../exportMidiClip';

const TICKS_PER_BEAT = 480;
const SMF_NOTE_OFF = 0x80;
const SMF_NOTE_ON = 0x90;
const SMF_CONTROL_CHANGE = 0xb0;
const SUSTAIN_PEDAL = 64;

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    getMidiStoreState: vi.fn(),
    downloadBlob: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getMidiStoreState: mocks.getMidiStoreState,
}));

vi.mock('#/utils/downloadFile', () => ({
    downloadBlob: mocks.downloadBlob,
}));

vi.mock('../getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));

const EVENT_KIND_BY_STATUS: Record<number, FileEvent['kind']> = {
    [SMF_NOTE_ON]: 'on',
    [SMF_NOTE_OFF]: 'off',
    [SMF_CONTROL_CHANGE]: 'cc',
};

type FileEvent = {
    tick: number;
    kind: 'on' | 'off' | 'cc';
    /** Pitch for a note, controller number for a control change. */
    data1: number;
    data2: number;
};

function readVarLen(bytes: Uint8Array, start: number): { value: number; next: number } {
    let value = 0;
    let index = start;
    for (;;) {
        const byte = bytes[index++]!;
        value = (value << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) {
            return { value, next: index };
        }
    }
}

/** Decodes the track chunk of the file the export handed to the download, in file order. */
function readExportedEvents(): FileEvent[] {
    const [bytes] = mocks.downloadBlob.mock.calls.at(-1)!;
    const data = bytes as Uint8Array;
    const trackEnd = 22 + new DataView(data.buffer, data.byteOffset).getUint32(18);
    const events: FileEvent[] = [];
    let index = 22;
    let tick = 0;
    while (index < trackEnd) {
        const delta = readVarLen(data, index);
        tick += delta.value;
        index = delta.next;
        const status = data[index]!;
        if (status === 0xff) {
            const length = readVarLen(data, index + 2);
            index = length.next + length.value;
            continue;
        }
        const kind = EVENT_KIND_BY_STATUS[status & 0xf0];
        expect(kind, `status byte ${status}`).toBeDefined();
        events.push({ tick, kind: kind!, data1: data[index + 1]!, data2: data[index + 2]! });
        index += 3;
    }
    return events;
}

type ClipFixture = {
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
};

type NoteFixture = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };
type ControllerFixture = { id: string; controller: number; value: number; beat: number; channel: number };

function note(id: string, startBeat: number, duration: number, pitch = 60): NoteFixture {
    return { id, pitch, startBeat, duration, velocity: 100 };
}

function sustain(id: string, beat: number, value: number): ControllerFixture {
    return { id, controller: SUSTAIN_PEDAL, value, beat, channel: 0 };
}

function exportClip(clip: ClipFixture, notes: NoteFixture[], controlChanges: ControllerFixture[]): FileEvent[] {
    mocks.getAllTracks.mockReturnValue([
        { id: 't1', name: 'Keys', clips: [{ id: 'clip', name: 'Clip', type: 'midi', ...clip }] },
    ]);
    mocks.getMidiStoreState.mockReturnValue({
        notesByClipId: { clip: notes },
        ccByClipId: { clip: controlChanges },
        pitchBendByClipId: {},
    });
    exportMidiClip('clip');
    return readExportedEvents();
}

function byTickThenPitch(left: number[], right: number[]): number {
    return left[0]! - right[0]! || left[1]! - right[1]!;
}

function ticks(events: FileEvent[], kind: FileEvent['kind']): number[] {
    return events.filter((event) => event.kind === kind).map((event) => event.tick);
}

describe('exportMidiClip writes what the clip plays', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('repeats a one-beat loop across a four-beat clip, note and controller on every pass', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4, loopEnabled: true, loopLength: 1 },
            [note('n', 0, 0.5)],
            [sustain('pedal', 0.25, 127)]
        );

        expect(ticks(events, 'on')).toEqual([0, 1, 2, 3].map((beat) => beat * TICKS_PER_BEAT));
        expect(ticks(events, 'off')).toEqual([0.5, 1.5, 2.5, 3.5].map((beat) => beat * TICKS_PER_BEAT));
        expect(events.filter((event) => event.kind === 'cc')).toEqual(
            [0.25, 1.25, 2.25, 3.25].map((beat) => ({
                tick: beat * TICKS_PER_BEAT,
                kind: 'cc',
                data1: SUSTAIN_PEDAL,
                data2: 127,
            }))
        );
    });

    it('leaves out the content past the loop end instead of writing it once', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4, loopEnabled: true, loopLength: 1 },
            [note('inside', 0, 0.5), note('past-loop-end', 2, 0.5, 62)],
            []
        );

        expect(events.filter((event) => event.data1 === 62)).toEqual([]);
        expect(ticks(events, 'on')).toEqual([0, 1, 2, 3].map((beat) => beat * TICKS_PER_BEAT));
    });

    it('writes the notes the scheduler projection plays for a slipped looped clip', () => {
        const clip = { startBeat: 8, endBeat: 12, midiOffsetBeats: 0.5, loopEnabled: true, loopLength: 1 };
        const stored = [note('wraps', 0.25, 0.25), note('inside', 0.5, 0.25, 62)];
        const events = exportClip(clip, stored, []);

        // The scheduler projects each pass with the pass head as its iteration start.
        const played = [0, 1, 2, 3].flatMap((pass) =>
            projectClipMidiEvents({
                events: stored,
                clipId: 'clip',
                clipStartBeat: clip.startBeat,
                clipEndBeat: clip.endBeat,
                iterationStartBeat: clip.startBeat + pass,
                loopLengthBeats: 1,
                midiOffsetBeats: clip.midiOffsetBeats,
                loopEnabled: true,
            })
        );
        const projectedStarts = played.map((projected) => [
            Math.round(projected.startBeat * TICKS_PER_BEAT),
            projected.pitch,
        ]);
        const fileStarts = events.filter((event) => event.kind === 'on').map((event) => [event.tick, event.data1]);

        expect(fileStarts.sort(byTickThenPitch)).toEqual(projectedStarts.sort(byTickThenPitch));
        // Derived by hand: the note a slip leaves 0.25 before the offset wraps to 0.75 in each pass.
        const wrappedNoteTicks = ticks(
            events.filter((event) => event.data1 === 60),
            'on'
        );
        expect(wrappedNoteTicks).toEqual([8.75, 9.75, 10.75, 11.75].map((beat) => beat * TICKS_PER_BEAT));
    });

    it('writes the controller moves the stored-controller scheduler projects for the clip', () => {
        const clip = { startBeat: 8, endBeat: 12, midiOffsetBeats: 0.5, loopEnabled: true, loopLength: 1 };
        const stored = [sustain('held', 0.25, 127), sustain('release', 0.75, 0)];
        const events = exportClip(clip, [], stored);

        const projected = projectClipControllerEvents({
            controlChanges: stored,
            clip,
            fromBeat: clip.startBeat,
            toBeat: clip.endBeat,
        });

        expect(projected.length).toBeGreaterThan(4);
        expect(events.map((event) => [event.tick, event.data2])).toEqual(
            projected.map((move) => [Math.round(move.beat * TICKS_PER_BEAT), move.value])
        );
    });

    it('releases a note, then moves a controller, then strikes the next note on one tick', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4 },
            [note('a', 0, 1), note('b', 1, 1)],
            [sustain('pedal', 1, 127)]
        );

        expect(events.filter((event) => event.tick === TICKS_PER_BEAT).map((event) => event.kind)).toEqual([
            'off',
            'cc',
            'on',
        ]);
    });

    it('puts a pedal carried into the clip start ahead of the chord struck there', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4, midiOffsetBeats: 2 },
            [note('c', 2, 1, 60), note('e', 2, 1, 64), note('g', 2, 1, 67)],
            [sustain('earlier-hidden-row', 1, 127)]
        );

        expect(events.filter((event) => event.tick === 0).map((event) => [event.kind, event.data1])).toEqual([
            ['cc', SUSTAIN_PEDAL],
            ['on', 60],
            ['on', 64],
            ['on', 67],
        ]);
    });

    it('does not write a note of no length', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4 },
            [note('zero', 1, 0), note('sliver', 2, 0.0004, 62), note('held', 3, 0.5, 64)],
            []
        );

        expect(events.map((event) => [event.kind, event.data1])).toEqual([
            ['on', 64],
            ['off', 64],
        ]);
    });
});
