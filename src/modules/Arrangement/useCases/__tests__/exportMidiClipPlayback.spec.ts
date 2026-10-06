import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import {
    assignGrooveTemplate,
    createGrooveTemplate,
    projectClipControllerEvents,
    projectClipMidiEvents,
} from '#/modules/MIDI/useCases';

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

    it('keeps time order for events a tick apart and orders by kind only within one beat', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4 },
            [note('first', 0, 1, 60), note('second', 2, 1, 62)],
            [
                { id: 'before-release', controller: 64, value: 127, beat: 0.9995, channel: 0 },
                { id: 'after-strike', controller: 66, value: 127, beat: 2.0004, channel: 0 },
            ]
        );

        // Both controllers round onto a note's tick; each stays on its own side of it in time.
        expect(events.map((event) => [event.kind, event.data1, event.tick])).toEqual([
            ['on', 60, 0],
            ['cc', 64, 480],
            ['off', 60, 480],
            ['on', 62, 960],
            ['cc', 66, 960],
            ['off', 62, 1440],
        ]);
    });

    describe('releases and strikes that round onto one tick', () => {
        const clip = { startBeat: 0, endBeat: 4 };

        function summary(events: FileEvent[]) {
            return events.map((event) => [event.kind, event.tick]);
        }

        it('releases a septuplet legato note before the next same-pitch note is struck', () => {
            const events = exportClip(clip, [note('a', 0, 1 / 7), note('b', 1 / 7, 1 / 7)], []);

            expect(summary(events)).toEqual([
                ['on', 0],
                ['off', 69],
                ['on', 69],
                ['off', 137],
            ]);
        });

        it('releases a note split at an off-grid boundary before its successor is struck', () => {
            const events = exportClip(clip, [note('a', 0, 1.0011), note('b', 1.0011, 0.5)], []);

            expect(summary(events)).toEqual([
                ['on', 0],
                ['off', 481],
                ['on', 481],
                ['off', 721],
            ]);
        });

        it('writes a pedal pressed just after a note ends behind that note release', () => {
            const events = exportClip(clip, [note('a', 0, 1.0011)], [sustain('p', 1.0015, 127)]);

            expect(summary(events)).toEqual([
                ['on', 0],
                ['off', 481],
                ['cc', 481],
            ]);
        });

        it('releases a sub-tick note ahead of a same-pitch strike on its release tick', () => {
            const events = exportClip(clip, [note('sliver', 2, 0.0004, 62), note('strike', 2.0015, 0.5, 62)], []);

            expect(summary(events)).toEqual([
                ['on', 960],
                ['off', 961],
                ['on', 961],
                ['off', 1201],
            ]);
        });

        it('writes a pedal behind the release of a sub-tick note it follows', () => {
            const events = exportClip(clip, [note('sliver', 2, 0.0004)], [sustain('p', 2.0015, 127)]);

            expect(summary(events)).toEqual([
                ['on', 960],
                ['off', 961],
                ['cc', 961],
            ]);
        });

        it('releases a note before a same-pitch note it overlaps by under a tick is struck', () => {
            const events = exportClip(clip, [note('a', 0, 1.0011), note('b', 1.00105, 0.5)], []);

            expect(summary(events)).toEqual([
                ['on', 0],
                ['off', 481],
                ['on', 481],
                ['off', 721],
            ]);
        });
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

    it('skips a note of no duration and writes a note shorter than a tick with one tick of length', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4 },
            [note('zero', 1, 0), note('sliver', 2, 0.0004, 62), note('held', 3, 0.5, 64)],
            []
        );

        expect(events.map((event) => [event.kind, event.data1, event.tick])).toEqual([
            ['on', 62, 960],
            ['off', 62, 961],
            ['on', 64, 1440],
            ['off', 64, 1680],
        ]);
    });

    it('writes the sliver a trimmed clip end leaves of a drum hit', () => {
        const events = exportClip({ startBeat: 0, endBeat: 4 }, [note('kick', 3.9995, 0.25, 36)], []);

        expect(events.map((event) => [event.kind, event.data1, event.tick])).toEqual([
            ['on', 36, 1920],
            ['off', 36, 1921],
        ]);
    });

    it('writes the clip-edge sliver of the last loop pass as a fifth hit', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4.001, loopEnabled: true, loopLength: 1 },
            [note('kick', 0, 0.25, 36)],
            []
        );

        expect(ticks(events, 'on')).toEqual([0, 1, 2, 3, 4].map((beat) => beat * TICKS_PER_BEAT));
        expect(ticks(events, 'off').at(-1)).toBe(4 * TICKS_PER_BEAT + 1);
    });

    it('keeps the wrapped tail struck at a pass head whole when a pass-end sliver shares its pitch', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4, loopEnabled: true, loopLength: 2 },
            [note('crossing', 1.9996, 0.25)],
            []
        );

        // Pass 0's sliver (tick 960) sits where pass 1's tail is struck, so it is not
        // written and its release cannot cut the tail; pass 1's own sliver has no
        // same-pitch note around it and keeps its tick of length.
        expect(events.map((event) => [event.kind, event.tick])).toEqual([
            ['on', 0],
            ['off', 120],
            ['on', 960],
            ['off', 1080],
            ['on', 1920],
            ['off', 1921],
        ]);
    });

    it('keeps a sub-tick note that starts on the tick a same-pitch note ends', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4.0004 },
            [note('before', 3.5, 0.5, 40), note('sliver', 4, 0.5, 40)],
            []
        );

        expect(events.map((event) => [event.kind, event.tick])).toEqual([
            ['on', 1680],
            ['off', 1920],
            ['on', 1920],
            ['off', 1921],
        ]);
    });

    it('keeps a sub-tick note whose release tick a same-pitch note is struck on', () => {
        const events = exportClip(
            { startBeat: 0, endBeat: 4 },
            [note('sliver', 2, 0.0004, 62), note('struck-on-release-tick', 961 / TICKS_PER_BEAT, 0.5, 62)],
            []
        );

        // The sliver's release sorts ahead of the strike on tick 961, so they never overlap.
        expect(events.map((event) => [event.kind, event.tick])).toEqual([
            ['on', 960],
            ['off', 961],
            ['on', 961],
            ['off', 1201],
        ]);
    });

    describe('with a controller carried into the head of a slipped clip', () => {
        it('writes the pedal ahead of the note struck on the clip start, which a slip of a twelfth of a beat leaves', () => {
            const events = exportClip(
                { startBeat: 16, endBeat: 20, midiOffsetBeats: -1 / 12 },
                [note('n', -1 / 12, 1)],
                [sustain('held', -1, 127)]
            );

            expect(events.map((event) => [event.kind, event.tick, event.data1])).toEqual([
                ['cc', 7680, SUSTAIN_PEDAL],
                ['on', 7680, 60],
                ['off', 8160, 60],
            ]);
        });

        it('writes the carry on the clip first tick when the slip is five thirds of a beat', () => {
            const events = exportClip(
                { startBeat: 7.1, endBeat: 11.1, midiOffsetBeats: -5 / 3 },
                [],
                [sustain('held', -3, 100), sustain('released', 0, 0)]
            );

            expect(events.map((event) => [event.tick, event.data2])).toEqual([
                [Math.round(7.1 * TICKS_PER_BEAT), 100],
                [4208, 0],
            ]);
        });

        it('writes one carry on each pass head of a looped slipped clip', () => {
            const events = exportClip(
                { startBeat: 16, endBeat: 20, midiOffsetBeats: -1 / 12, loopEnabled: true, loopLength: 1 },
                [],
                [sustain('held', -1, 127), sustain('released', 0.5, 0)]
            );

            // Each pass opens on 127, in force from before its span, then releases 7/12 of a beat in.
            expect(events.map((event) => [event.tick, event.data2])).toEqual(
                [0, 1, 2, 3].flatMap((pass) => [
                    [(16 + pass) * TICKS_PER_BEAT, 127],
                    [(16 + pass) * TICKS_PER_BEAT + 280, 0],
                ])
            );
        });
    });

    describe('in the coordinates the scheduler projects in', () => {
        type SchedulerClip = { startBeat: number; endBeat: number; loopLength: number };

        /** The segments of positive length the note scheduler's projection returns, pass by pass. */
        function schedulerSegments(clip: SchedulerClip, stored: NoteFixture[]) {
            const passes = Math.ceil((clip.endBeat - clip.startBeat) / clip.loopLength);
            return Array.from({ length: passes }, (_, pass) =>
                projectClipMidiEvents({
                    events: stored,
                    clipId: 'clip',
                    clipStartBeat: clip.startBeat,
                    clipEndBeat: clip.endBeat,
                    iterationStartBeat: clip.startBeat + pass * clip.loopLength,
                    loopLengthBeats: clip.loopLength,
                    midiOffsetBeats: 0,
                    loopEnabled: true,
                })
            )
                .flat()
                .filter((segment) => segment.duration > 0);
        }

        it('writes a loop pass of a clip not at beat 0 once, without a rounding sliver of its wrap', () => {
            const clip = { startBeat: 4, endBeat: 12, loopLength: 4 };
            const stored = [note('third', 1 / 3, 1 / 3, 36)];

            const events = exportClip({ ...clip, loopEnabled: true }, stored, []);

            // The note starts a third of a beat into each pass: 4 + 1/3 and 8 + 1/3 beats.
            expect(schedulerSegments(clip, stored)).toHaveLength(2);
            expect(ticks(events, 'on')).toEqual([2080, 4000]);
            expect(ticks(events, 'off')).toEqual([2240, 4160]);
        });

        it('writes as many hits as the scheduler projection has segments on thirds, fifths and twelfths', () => {
            const clip = { startBeat: 4 / 16, endBeat: 4 / 16 + 12, loopLength: 4 };
            // One pitch per note, and none struck on a pass head, so no same-pitch note
            // covers another's wrap residue there: every segment the projection returns is written.
            const grid = [3, 5, 12].flatMap((division) =>
                Array.from({ length: 4 * division - 1 }, (_, step) => ({ division, start: (step + 1) / division }))
            );
            const notes = grid.map(({ division, start }, index) => note(`n${index}`, start, 1 / division, 20 + index));

            const events = exportClip({ ...clip, loopEnabled: true }, notes, []);

            expect(ticks(events, 'on')).toHaveLength(schedulerSegments(clip, notes).length);
        });
    });

    describe('with a groove committed to the project', () => {
        afterEach(() => {
            grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        });

        it('writes the stored timing and velocity, not the grooved ones', () => {
            grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
            createGrooveTemplate({
                id: 'push',
                name: 'Push',
                subdivision: '1/16',
                slots: [{ index: 0, timingOffset: 0.5, dynamicsOffset: 0.2 }],
                provenance: { type: 'user', sourceId: 'push' },
            });
            assignGrooveTemplate({ consumerType: 'sequencer', consumerId: 'project', templateId: 'push', amount: 0.8 });
            assignGrooveTemplate({ consumerType: 'clip', consumerId: 'clip', templateId: 'push', amount: 0.6 });
            const stored = { id: 'hit', pitch: 60, startBeat: 0, duration: 0.5, velocity: 80 };

            // The same note is moved and re-weighted by the projection playback reads.
            const [played] = projectClipMidiEvents({
                events: [stored],
                clipId: 'clip',
                clipStartBeat: 0,
                clipEndBeat: 4,
                iterationStartBeat: 0,
                loopLengthBeats: 4,
                midiOffsetBeats: 0,
            });
            expect(played?.startBeat).toBeGreaterThan(0);
            expect(played?.velocity).not.toBe(80);

            const events = exportClip({ startBeat: 0, endBeat: 4 }, [stored], []);

            expect(events.map((event) => [event.kind, event.tick, event.data2])).toEqual([
                ['on', 0, 80],
                ['off', 0.5 * TICKS_PER_BEAT, 0],
            ]);
        });
    });
});
