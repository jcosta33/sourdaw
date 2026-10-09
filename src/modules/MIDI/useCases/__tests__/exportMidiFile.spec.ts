import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { type MidiCC, type MidiNote } from '../../models/MidiNote';
import { downloadBlob } from '../../repositories/downloadFile';
import { downloadMidiFile } from '../exportMidiFile';

vi.mock('../../repositories/downloadFile', () => ({
    downloadBlob: vi.fn(),
}));

function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) {
        return [items];
    }
    return items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
    );
}

function cc(id: string, controller: number, value: number, beat: number): MidiCC {
    return { id, controller, value, beat, channel: 0 };
}

function exportedHex(notes: MidiNote[], ccs: MidiCC[]): string {
    downloadMidiFile({ clipName: 'C', clipStartBeat: 0, notes, ccs });
    return toHex(lastDownloadedBytes());
}

function exportedRowsHex(rows: (MidiNote | MidiCC)[]): string {
    return exportedHex(
        rows.filter((row): row is MidiNote => 'pitch' in row),
        rows.filter((row): row is MidiCC => 'controller' in row)
    );
}

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0');
    }
    return out;
}

/**
 * Captures the bytes passed to downloadBlob as a Uint8Array (asserts at call time
 * that the harness really received binary, not a string).
 */
function lastDownloadedBytes(): Uint8Array {
    const call = vi.mocked(downloadBlob).mock.calls.at(-1);
    expect(call, 'downloadBlob should have been called').toBeDefined();
    const [bytes] = call!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    return bytes as Uint8Array;
}

describe('downloadMidiFile — Standard MIDI File binary encoding', () => {
    beforeEach(() => {
        vi.mocked(downloadBlob).mockReset();
    });

    it('produces a spec-correct type-0 SMF for a single note (header, MTrk, PPQN=480)', () => {
        downloadMidiFile({
            clipName: 'Bass',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            ccs: [],
        });

        // Full byte stream derived from the SMF spec, not from the implementation:
        //   MThd  len=6  format=0  ntracks=1  division=480 (0x01E0)
        //   MTrk  len=21
        //   00 FF 03 04 'Bass'          track-name meta event, delta 0
        //   00 90 3C 64                 note-on ch0, pitch 60, velocity 100, delta 0
        //   83 60 80 3C 00              note-off ch0, pitch 60, delta 480 (var-len 83 60)
        //   00 FF 2F 00                 end-of-track meta event, delta 0
        expect(toHex(lastDownloadedBytes())).toBe(
            '4d546864000000060000000101e0' + // MThd header
                '4d54726b00000015' + // MTrk + track length 21
                '00ff030442617373' + // track name "Bass"
                '00903c64' + // note on
                '8360803c00' + // note off after delta 480
                '00ff2f00' // end of track
        );
    });

    it('encodes note start/end ticks relative to clipStartBeat, not beat 0', () => {
        // A note at startBeat 0 inside a clip starting at beat 4 must land at tick 4*480=1920.
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 4,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 0.5, velocity: 100 }],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // start tick = (4 + 0) * 480 = 1920. The SMF variable-length encoding of 1920
        // splits it into 7-bit groups LSB-first ([0, 15]) then writes MSB-first with the
        // continuation bit on all but the last byte: 0x8F 0x00 (decodes back to 1920).
        const noteOnIdx = hex.indexOf('903c64');
        expect(noteOnIdx).toBeGreaterThan(-1);
        // The two bytes immediately before the note-on are the delta var-len for 1920.
        expect(hex.slice(noteOnIdx - 4, noteOnIdx)).toBe('8f00');
    });

    it('writes CC events as 0xB0 status with controller and value clamped to 0-127', () => {
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [],
            ccs: [{ id: 'cc1', controller: 7, value: 80, beat: 0, channel: 0 }],
        });

        const hex = toHex(lastDownloadedBytes());
        // CC status 0xB0, controller 7 (0x07), value 80 (0x50), delta 0.
        expect(hex).toContain('00b00750');
    });

    it('clamps out-of-range velocity/pitch/controller/value into the MIDI 0-127 range', () => {
        // Per MIDI spec, data bytes must be 0-127. Velocity also floored at 1 (a note-on
        // with velocity 0 is a note-off by convention, which would corrupt the file).
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 200, startBeat: 0, duration: 1, velocity: 9999 }],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // pitch clamped to 127 (0x7F), velocity clamped to 127 (0x7F) — note the note-on
        // must NOT carry velocity 0 (that would read as note-off).
        expect(hex).toContain('907f7f');
        expect(hex).not.toContain('907f00');
    });

    it('floors note velocity at 1 so a zero velocity does not serialize as a note-off', () => {
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 0 }],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // velocity clamped to min 1 -> 0x01, not 0x00.
        expect(hex).toContain('903c01');
    });

    it('clamps CC controller and value into range', () => {
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [],
            ccs: [{ id: 'cc1', controller: 200, value: -5, beat: 0, channel: 0 }],
        });

        const hex = toHex(lastDownloadedBytes());
        // controller clamped 127 (0x7F), value clamped 0 (0x00).
        expect(hex).toContain('00b07f00');
    });

    it('encodes the channel in the low nibble of the status byte', () => {
        // MIDI channels are 0-15; the status byte is 0x90 | channel for note-on,
        // 0x80 | channel for note-off, 0xB0 | channel for CC.
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, channel: 3 }],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // note-on status 0x93, note-off status 0x83.
        expect(hex).toContain('933c64');
        expect(hex).toContain('833c00');
    });

    it('encodes an explicit CC channel in the status byte', () => {
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [],
            ccs: [{ id: 'cc1', controller: 1, value: 0, beat: 0, channel: 5 }],
        });

        const hex = toHex(lastDownloadedBytes());
        // CC status 0xB0 | 5 = 0xB5, controller 1 (0x01), value 0 (0x00).
        expect(hex).toContain('b50100');
    });

    it('masks channel to the low nibble (channel 16 wraps to 0)', () => {
        // A channel value >= 16 is invalid MIDI; masking with 0x0F keeps the status legal.
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, channel: 16 }],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // 16 & 0x0F = 0 -> note-on status 0x90.
        expect(hex).toContain('903c64');
    });

    it('sorts simultaneous events so note-off precedes a same-tick note-on delta of 0', () => {
        // Two notes: n1 ends exactly when n2 starts (both at tick 480). The events must
        // be ordered by tick and emit zero deltas between same-tick events.
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [
                { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { id: 'n2', pitch: 62, startBeat: 1, duration: 1, velocity: 100 },
            ],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // n1 note-off (80 3C 00) should be immediately followed by n2 note-on with a
        // delta-0 prefix (00 92 ...) — the second note-on is on a different pitch (62=0x3E).
        // n1 note-off (80 3C 00) at delta 480 (8360) is immediately followed by a delta-0
        // (00) prefix on n2's note-on (90 3E 64) — the boundary reads "...8360803c00" + "00903e64".
        expect(hex).toContain('8360803c0000903e64');
    });

    it('orders one tick as note-off, controller, note-on whatever order the rows were given in', () => {
        // Note A ends and note B starts on tick 480, the same pitch, with a sustain
        // pedal press on that tick. The release must not be caught by the pedal and
        // the new note must sound under it: 80 3C 00, B0 40 7F, 90 3C 64.
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [
                { id: 'b', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                { id: 'a', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
            ],
            ccs: [{ id: 'pedal', controller: 64, value: 127, beat: 1, channel: 0 }],
        });

        // Delta 480 (83 60) reaches the tick; the three events then share it with delta 0.
        expect(toHex(lastDownloadedBytes())).toContain('8360803c0000b0407f00903c64');
    });

    it('writes one file for every stored order of notes whose beats differ by less than a tick', () => {
        // Note a releases pitch 60 at beat 1.0004 and b strikes it at 1.0, both on tick
        // 480, and d strikes pitch 64 at 1.0002 between them. A release goes ahead of a
        // strike of its own key, so off60 precedes on60 whatever order the rows are stored in.
        const a: MidiNote = { id: 'a', pitch: 60, startBeat: 0, duration: 1.0004, velocity: 100 };
        const b: MidiNote = { id: 'b', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };
        const d: MidiNote = { id: 'd', pitch: 64, startBeat: 1.0002, duration: 1, velocity: 100 };

        const files = permutations([a, b, d]).map((notes) => {
            downloadMidiFile({ clipName: 'C', clipStartBeat: 0, notes, ccs: [] });
            return toHex(lastDownloadedBytes());
        });

        expect(new Set(files).size).toBe(1);
        // Tick 480 in file order: on64 (1.0002), off60 (1.0004), on60 (struck at 1.0, after its release).
        expect(files[0]).toContain('836090406400803c0000903c64');
    });

    it('writes one file for every stored order when a controller sits between a strike and its key release', () => {
        // The controller at 1.0002 is later than the strike (1.0) but earlier than the
        // release (1.0004). The strike is moved to its release, so the controller keeps its
        // own time ahead of both: B0 40 7F, 80 3C 00, 90 3C 64.
        const a: MidiNote = { id: 'a', pitch: 60, startBeat: 0, duration: 1.0004, velocity: 100 };
        const b: MidiNote = { id: 'b', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };
        const pedal: MidiCC = { id: 'pedal', controller: 64, value: 127, beat: 1.0002, channel: 0 };

        const files = permutations<MidiNote | MidiCC>([a, b, pedal]).map((rows) => {
            downloadMidiFile({
                clipName: 'C',
                clipStartBeat: 0,
                notes: rows.filter((row): row is MidiNote => 'pitch' in row),
                ccs: rows.filter((row): row is MidiCC => 'controller' in row),
            });
            return toHex(lastDownloadedBytes());
        });

        expect(new Set(files).size).toBe(1);
        expect(files[0]).toContain('8360b0407f00803c0000903c64');
    });

    it('writes one on and off pair for sub-tick notes of one key that share a start tick', () => {
        // Both notes are shorter than a tick and round to start tick 480, so written
        // as they are they would strike pitch 60 twice and release it twice.
        const first: MidiNote = { id: 'first', pitch: 60, startBeat: 1, duration: 0.0001, velocity: 100 };
        const second: MidiNote = { id: 'second', pitch: 60, startBeat: 1.0001, duration: 0.0001, velocity: 90 };

        const files = [
            [first, second],
            [second, first],
        ].map((notes) => {
            downloadMidiFile({ clipName: 'C', clipStartBeat: 0, notes, ccs: [] });
            return toHex(lastDownloadedBytes());
        });

        expect(files[1]).toBe(files[0]);
        // The earlier note is the one written: on at tick 480 with velocity 100, off one tick later.
        expect(files[0]).toContain('8360903c6401803c0000ff2f00');
        expect(files[0]!.match(/903c/g)).toHaveLength(1);
        expect(files[0]!.match(/803c/g)).toHaveLength(1);
    });

    it('keeps the stored order of controllers on one beat, as playback posts them', () => {
        // Pedal down then up ends the pedal up; up then down ends it down. The same
        // controller and the same beat, so only the stored order tells them apart.
        expect(exportedHex([], [cc('down', 64, 127, 1), cc('up', 64, 0, 1)])).toContain('8360b0407f00b04000');
        expect(exportedHex([], [cc('up', 64, 0, 1), cc('down', 64, 127, 1)])).toContain('8360b0400000b0407f');
    });

    it('keeps an RPN select-then-data sequence in its stored order on one beat', () => {
        const rpn = [cc('msb', 101, 0, 1), cc('lsb', 100, 0, 1), cc('data', 6, 12, 1), cc('fine', 38, 5, 1)];

        // 101, 100, 6, 38 as stored: data bytes alone would order them 6, 38, 100, 101.
        expect(exportedHex([], rpn)).toContain('8360b0650000b0640000b0060c00b02605');
        expect(exportedHex([], [...rpn].reverse())).toContain('8360b0260500b0060c00b0640000b06500');
    });

    it('writes a chord struck on one beat as the same bytes whatever order its notes are stored in', () => {
        const c: MidiNote = { id: 'c', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };
        const e: MidiNote = { id: 'e', pitch: 64, startBeat: 1, duration: 1, velocity: 100 };

        const files = [exportedHex([c, e], []), exportedHex([e, c], [])];

        expect(files[1]).toBe(files[0]);
        // Strikes then releases, each pair by data bytes: pitch 60 ahead of pitch 64.
        expect(files[0]).toContain('8360903c64009040648360803c0000804000');
    });

    it('releases, moves a controller, then strikes a key on rising beats of one tick', () => {
        // Note a ends at 1.0, the pedal moves at 1.0002 and note b strikes the key at
        // 1.0004: the strike keeps the later of its own beat and its release's.
        const a: MidiNote = { id: 'a', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const b: MidiNote = { id: 'b', pitch: 60, startBeat: 1.0004, duration: 1, velocity: 100 };
        const pedal = cc('pedal', 64, 127, 1.0002);

        const files = permutations<MidiNote | MidiCC>([a, b, pedal]).map((rows) => exportedRowsHex(rows));

        expect(new Set(files).size).toBe(1);
        expect(files[0]).toContain('8360803c0000b0407f00903c64');
    });

    it('strikes a key after both releases of it on the strike tick', () => {
        // Notes a and c release pitch 60 at 1.0001 and 1.0004, and b strikes it at 1.0
        // on tick 480: the strike takes the later release's beat and follows both.
        const a: MidiNote = { id: 'a', pitch: 60, startBeat: 0, duration: 1.0001, velocity: 100 };
        const c: MidiNote = { id: 'c', pitch: 60, startBeat: 0.5, duration: 0.5004, velocity: 100 };
        const b: MidiNote = { id: 'b', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };

        const files = permutations([a, b, c]).map((notes) => exportedHex(notes, []));

        expect(new Set(files).size).toBe(1);
        expect(files[0]).toContain('803c0000803c0000903c64');
    });

    it('collapses sub-tick notes that tie on start to the shorter, then the softer one, in any stored order', () => {
        const loud: MidiNote = { id: 'loud', pitch: 60, startBeat: 1, duration: 0.0001, velocity: 110 };
        const soft: MidiNote = { id: 'soft', pitch: 60, startBeat: 1, duration: 0.0001, velocity: 90 };
        const long: MidiNote = { id: 'long', pitch: 60, startBeat: 1, duration: 0.0002, velocity: 90 };

        // Same start and end: the softer is written (velocity 90 = 0x5a).
        const byVelocity = [exportedHex([loud, soft], []), exportedHex([soft, loud], [])];
        expect(byVelocity[1]).toBe(byVelocity[0]);
        expect(byVelocity[0]).toContain('8360903c5a01803c00');

        // Same start, different end: the shorter is written, whatever the velocities (loud = 0x6e).
        const byEnd = [exportedHex([loud, long], []), exportedHex([long, loud], [])];
        expect(byEnd[1]).toBe(byEnd[0]);
        expect(byEnd[0]).toContain('8360903c6e01803c00');
    });

    it('drops a sub-tick note that starts while a same-pitch note is held, which would cut it', () => {
        const held: MidiNote = { id: 'held', pitch: 60, startBeat: 0, duration: 2, velocity: 100 };
        const sliver: MidiNote = { id: 'sliver', pitch: 60, startBeat: 1, duration: 0.0004, velocity: 100 };

        const hex = exportedHex([held, sliver], []);

        // One strike at tick 0 and one release at tick 960 (var-len 87 40); the sliver at tick 480 is not written.
        expect(hex).toContain('00903c648740803c00');
        expect(hex.match(/903c/g)).toHaveLength(1);
        expect(hex.match(/803c/g)).toHaveLength(1);
    });

    it('writes a sub-tick note of another pitch struck while a note is held', () => {
        const held: MidiNote = { id: 'held', pitch: 60, startBeat: 0, duration: 2, velocity: 100 };
        const other: MidiNote = { id: 'other', pitch: 62, startBeat: 1, duration: 0.0004, velocity: 100 };

        const hex = exportedHex([held, other], []);

        // Pitch 62 on at tick 480 and off one tick later: its own key is not held.
        expect(hex).toContain('903e64');
        expect(hex).toContain('803e00');
    });

    it('writes a sub-tick note of another channel struck while a note is held', () => {
        const held: MidiNote = { id: 'held', pitch: 60, startBeat: 0, duration: 2, velocity: 100 };
        const other: MidiNote = { id: 'other', pitch: 60, startBeat: 1, duration: 0.0004, velocity: 100, channel: 1 };

        const hex = exportedHex([held, other], []);

        expect(hex).toContain('913c64');
        expect(hex).toContain('813c00');
    });

    it('writes a note of 5e-5 beats with one tick of length, as playback sounds it', () => {
        const hex = exportedHex([{ id: 'short', pitch: 60, startBeat: 1, duration: 5e-5, velocity: 100 }], []);

        // On at tick 480 (delta 83 60), off one tick later at 481.
        expect(hex).toContain('8360903c6401803c00');
    });

    it('writes a pedal on a sub-tick note start tick that follows its true end behind the release', () => {
        // The note ends at 1.0002 but releases on tick 481, and the pedal pressed at
        // 1.0004 rounds onto the start tick 480. Playback posts the release before the
        // pedal, so the pedal must not precede the release and hold the note.
        const sliver: MidiNote = { id: 'sliver', pitch: 62, startBeat: 1, duration: 0.0002, velocity: 100 };
        const pedal = cc('pedal', 64, 127, 1.0004);

        const files = permutations<MidiNote | MidiCC>([sliver, pedal]).map((rows) => exportedRowsHex(rows));

        expect(new Set(files).size).toBe(1);
        // on 62 at tick 480 (83 60), off at 481 (01), pedal behind it (00 b0 40 7f).
        expect(files[0]).toContain('8360903e6401803e0000b0407f');
    });

    it('writes a strike of another pitch on a sub-tick note start tick after the release', () => {
        // The strike at 1.0004 rounds onto the sliver's start tick. Playback releases
        // the sliver at 1.0002 before the strike sounds, so a mono synth retriggers;
        // the file must not hold the sliver under the strike as a legato glide.
        const sliver: MidiNote = { id: 'sliver', pitch: 60, startBeat: 1, duration: 0.0002, velocity: 100 };
        const strike: MidiNote = { id: 'strike', pitch: 64, startBeat: 1.0004, duration: 1, velocity: 100 };

        const files = permutations([sliver, strike]).map((notes) => exportedHex(notes, []));

        expect(new Set(files).size).toBe(1);
        // on 60 at tick 480, off at 481, then the strike behind the release.
        expect(files[0]).toContain('8360903c6401803c0000904064');
    });

    it('keeps a pedal on a sub-tick note start tick before its true end ahead of the release', () => {
        // The pedal at 1.0001 follows the strike but precedes the true end (1.0004), so
        // playback holds the note under it and the file keeps the pedal on the start tick.
        const sliver: MidiNote = { id: 'sliver', pitch: 60, startBeat: 1, duration: 0.0004, velocity: 100 };
        const pedal = cc('pedal', 64, 127, 1.0001);

        const hex = exportedHex([sliver], [pedal]);

        expect(hex).toContain('8360903c6400b0407f01803c00');
    });

    it('does not write a note of no duration, which playback does not sound', () => {
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'zero', pitch: 60, startBeat: 1, duration: 0, velocity: 100 }],
            ccs: [{ id: 'cc', controller: 7, value: 80, beat: 0, channel: 0 }],
        });

        const hex = toHex(lastDownloadedBytes());
        expect(hex).not.toContain('903c');
        expect(hex).not.toContain('803c');
        expect(hex).toContain('00b00750');
    });

    it('warns and truncates a variable-length quantity exceeding the 28-bit SMF limit', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

        // The truncation guards the *delta* between events. VAR_LEN_MAX = 0x0FFFFFFF.
        // Place a second note far enough that its delta from the first note's off event
        // (tick 480) exceeds the limit. round(559243 * 480) - 480 = 268436160 > 268435455.
        const farBeat = 559243;
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [
                { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { id: 'n2', pitch: 62, startBeat: farBeat, duration: 1, velocity: 100 },
            ],
            ccs: [],
        });

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds the 28-bit SMF limit'));
        warn.mockRestore();
    });

    it('does not warn when every inter-event delta fits within the 28-bit limit', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
            ccs: [],
        });

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('does not download when there is no note or CC data', () => {
        downloadMidiFile({ clipName: 'Empty', clipStartBeat: 0, notes: [], ccs: [] });

        expect(downloadBlob).not.toHaveBeenCalled();
    });

    it('downloads with audio/midi mime and a .mid extension', () => {
        downloadMidiFile({
            clipName: 'Hook',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            ccs: [],
        });

        expect(downloadBlob).toHaveBeenCalledTimes(1);
        const [, name, mime] = vi.mocked(downloadBlob).mock.calls[0]!;
        expect(mime).toBe('audio/midi');
        expect(name.endsWith('.mid')).toBe(true);
    });

    it('sanitizes the output filename by replacing disallowed characters', () => {
        downloadMidiFile({
            clipName: 'Lead/Hook:*?',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            ccs: [],
        });

        const [, name] = vi.mocked(downloadBlob).mock.calls[0]!;
        expect(name).toBe('Lead_Hook___.mid');
    });

    it('emits an end-of-track meta event (FF 2F 00) at the tail of the track', () => {
        downloadMidiFile({
            clipName: 'C',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            ccs: [],
        });

        const hex = toHex(lastDownloadedBytes());
        // The final four bytes are delta-0 + end-of-track meta event.
        expect(hex.endsWith('00ff2f00')).toBe(true);
    });
});
