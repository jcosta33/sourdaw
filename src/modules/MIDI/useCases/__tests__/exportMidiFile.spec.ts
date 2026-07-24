import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { downloadBlob } from '../../repositories/downloadFile';
import { downloadMidiFile } from '../exportMidiFile';

vi.mock('../../repositories/downloadFile', () => ({
    downloadBlob: vi.fn(),
}));

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
