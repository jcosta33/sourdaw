import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * midiImportWorker parses Standard MIDI Files (SMF, spec 1.0) on a background
 * thread. These tests exercise the worker's `self.onmessage` handler in the
 * jsdom environment: importing the module registers `self.onmessage` as a side
 * effect. Each test replaces `self.postMessage` with a spy (jsdom's native
 * window.postMessage requires a targetOrigin and would throw on the worker's
 * single-arg call), then dispatches a synthetic MessageEvent carrying a
 * hand-crafted ArrayBuffer. The handler reads `self.postMessage` at dispatch
 * time, so the spy is installed in `beforeEach` after the import side effect.
 *
 * Every expected value is derived from the SMF / MIDI spec, not from the
 * implementation's output. Where a real MIDI file would be ambiguous, we
 * construct the minimal byte sequence that exercises one parser branch.
 */

// Side-effect import: evaluates the module so `self.onmessage` is registered.
import '../midiImportWorker';

// --- Byte-level MIDI builders ------------------------------------------------

/**
 * SMF variable-length quantity (varlen) per spec §1: 7 bits per byte, the
 * high (0x80) bit signals "more bytes follow". The value is transmitted
 * big-endian (most-significant group first) with the continuation bit set on
 * every byte except the last. E.g. 0 -> [0x00], 127 -> [0x7f],
 * 128 -> [0x81,0x00], 192 -> [0x81,0x40].
 */
function varlen(value: number): number[] {
    if (value < 0) {
        throw new Error('varlen is undefined for negative values');
    }
    // Extract the value in 7-bit groups; the first group is always emitted
    // (even for 0). Then reverse so the most-significant group leads.
    const groups: number[] = [];
    let rest = value;
    do {
        groups.push(rest & 0x7f);
        rest >>>= 7;
    } while (rest > 0);
    // groups is least-significant first; reverse for big-endian order, and
    // set the continuation bit on every byte except the last.
    return groups.reverse().map((g, i) => (i < groups.length - 1 ? g | 0x80 : g));
}

/** Big-endian uint32 of an array of 4 byte values. */
function u32(a: number, b: number, c: number, d: number): number[] {
    return [a, b, c, d];
}

function mThd(format: number, numTracks: number, ticksPerBeat: number): number[] {
    return [
        ...u32(0x4d, 0x54, 0x68, 0x64), // "MThd"
        ...u32(0, 0, 0, 6), // header length always 6
        (format >> 8) & 0xff,
        format & 0xff,
        (numTracks >> 8) & 0xff,
        numTracks & 0xff,
        (ticksPerBeat >> 8) & 0xff,
        ticksPerBeat & 0xff,
    ];
}

/**
 * Build an MTrk chunk from a list of channel events, each prefixed by its
 * delta-time varlen. Always terminates with an End-Of-Track meta event.
 */
function mTrk(events: { status: number; data1: number; data2?: number; delta: number }[]): number[] {
    const body: number[] = [];
    for (const ev of events) {
        body.push(...varlen(ev.delta));
        body.push(ev.status & 0xff);
        body.push(ev.data1 & 0xff);
        if (ev.data2 !== undefined) {
            body.push(ev.data2 & 0xff);
        }
    }
    // End-of-track: delta 0, 0xff 0x2f 0x00.
    body.push(0x00, 0xff, 0x2f, 0x00);
    const len = body.length;
    return [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, (len >> 8) & 0xff, len & 0xff), ...body];
}

/**
 * MThd with a declared header length longer than the 6-byte body. SMF 1.0
 * requires a reader to skip the surplus; real exporters do emit it.
 */
function mThdWithTrailer(format: number, numTracks: number, division: number, trailer: number[]): number[] {
    const length = 6 + trailer.length;
    return [
        ...u32(0x4d, 0x54, 0x68, 0x64),
        ...u32(0, 0, (length >> 8) & 0xff, length & 0xff),
        (format >> 8) & 0xff,
        format & 0xff,
        (numTracks >> 8) & 0xff,
        numTracks & 0xff,
        (division >> 8) & 0xff,
        division & 0xff,
        ...trailer,
    ];
}

/**
 * Wrap a fully-formed track body (deltas included, End-Of-Track included) into
 * an MTrk chunk. Unlike `mTrk` this appends nothing, so a test can control the
 * delta that precedes End-Of-Track.
 */
function mTrkRaw(body: number[]): number[] {
    const len = body.length;
    return [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, (len >> 8) & 0xff, len & 0xff), ...body];
}

/** End-Of-Track meta preceded by `delta` ticks. */
function endOfTrack(delta: number): number[] {
    return [...varlen(delta), 0xff, 0x2f, 0x00];
}

function toBuffer(bytes: number[]): ArrayBuffer {
    return new Uint8Array(bytes).buffer;
}

// --- Worker harness ----------------------------------------------------------

const posted: unknown[] = [];
const workerSelf = self as unknown as {
    postMessage: (message: unknown) => void;
    onmessage: ((e: MessageEvent) => void) | null;
};
const originalPostMessage = workerSelf.postMessage;

function dispatchParse(buffer: ArrayBuffer): void {
    if (typeof workerSelf.onmessage !== 'function') {
        throw new TypeError('worker did not register self.onmessage');
    }
    workerSelf.onmessage(new MessageEvent('message', { data: { type: 'parse', buffer } }));
}

function dispatchRaw(type: string, buffer: ArrayBuffer): void {
    if (typeof workerSelf.onmessage !== 'function') {
        throw new TypeError('worker did not register self.onmessage');
    }
    workerSelf.onmessage(new MessageEvent('message', { data: { type, buffer } }));
}

function lastPosted(): { type: string } & Record<string, unknown> {
    const last = posted[posted.length - 1];
    if (last === undefined) {
        throw new Error('worker did not post a message');
    }
    return last as { type: string } & Record<string, unknown>;
}

type ParsedNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };
type ParsedTrack = { name: string; notes: ParsedNote[]; endTick: number };

/** Assert the last posted message is a 'parsed' result and return its tracks. */
function parsedTracks(): ParsedTrack[] {
    const msg = lastPosted();
    if (msg.type !== 'parsed') {
        throw new Error(`expected 'parsed' message, got '${msg.type}': ${JSON.stringify(msg)}`);
    }
    return msg.tracks as ParsedTrack[];
}

/** Return the first track, throwing if the worker emitted none. */
function firstTrack(): ParsedTrack {
    const tracks = parsedTracks();
    const first = tracks[0];
    if (first === undefined) {
        throw new Error(`expected at least one track, got ${tracks.length}`);
    }
    return first;
}

/** Return the first note of the first track. */
function firstNote(): ParsedNote {
    const note = firstTrack().notes[0];
    if (note === undefined) {
        throw new Error('expected at least one note');
    }
    return note;
}

describe('midiImportWorker', () => {
    let postSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        posted.length = 0;
        // jsdom's window.postMessage requires a (message, targetOrigin) call;
        // the worker uses the single-arg form, so route every post into the spy.
        const spy: (message: unknown) => void = (message) => {
            posted.push(message);
        };
        postSpy = vi.fn(spy);
        workerSelf.postMessage = postSpy as (message: unknown) => void;
    });

    afterEach(() => {
        workerSelf.postMessage = originalPostMessage;
        vi.restoreAllMocks();
    });

    describe('message protocol', () => {
        it('ignores messages whose type is not "parse" without posting', () => {
            dispatchRaw('unknown', new ArrayBuffer(0));
            expect(postSpy).not.toHaveBeenCalled();
        });

        it('posts a structured error when the buffer is not a valid MIDI file', () => {
            // Header "XXXX..." instead of "MThd".
            dispatchParse(toBuffer(u32(0x58, 0x58, 0x58, 0x58)));
            expect(lastPosted()).toEqual({ type: 'error', message: 'Not a valid MIDI file' });
        });

        it('posts an error (not a throw) for MIDI format 2', () => {
            // Format 2 (multi-song) is unsupported per the parser.
            dispatchParse(toBuffer(mThd(2, 0, 480)));
            expect(lastPosted()).toEqual({ type: 'error', message: 'MIDI format 2 not supported' });
        });

        it('wraps a non-Error throw into a string-message error', () => {
            // An ArrayBuffer shorter than the 4-byte header chunk id forces the
            // DataView read to throw a RangeError (Error subclass) — verify the
            // catch produces a message string either way.
            dispatchParse(new ArrayBuffer(1));
            const msg = lastPosted();
            expect(msg.type).toBe('error');
            expect(typeof msg.message).toBe('string');
            expect((msg.message as string).length).toBeGreaterThan(0);
        });
    });

    describe('header parsing', () => {
        it('reads ticksPerBeat and defaults tempo to 120 for an empty format-0 file', () => {
            // SMF spec: ticksPerBeat is a 14-bit value in the header division
            // word; 480 ppq is a common DAW default. No tempo meta -> 120 BPM.
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrk([])]));
            expect(lastPosted()).toEqual({ type: 'parsed', tracks: [], ticksPerBeat: 480, tempo: 120 });
        });

        it('parses a format-1 file with zero tracks', () => {
            dispatchParse(toBuffer(mThd(1, 0, 96)));
            expect(lastPosted()).toEqual({ type: 'parsed', tracks: [], ticksPerBeat: 96, tempo: 120 });
        });

        it('rejects SMPTE-encoded timing instead of reading the division as PPQN', () => {
            // Bit 15 set selects SMPTE: high byte is the negative frame rate
            // (0xe7 = -25 fps), low byte the ticks per frame (0x28 = 40). Read as
            // PPQN this is 59176 ticks per beat and every startBeat is nonsense.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 0xe728), ...track]));
            expect(lastPosted()).toEqual({ type: 'error', message: 'SMPTE-encoded MIDI timing is not supported' });
        });

        it('rejects a zero division rather than emitting Infinity beats', () => {
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 0), ...track]));
            expect(lastPosted()).toEqual({ type: 'error', message: 'Invalid MIDI file: zero ticks per beat' });
        });

        it('skips header bytes beyond the declared 6-byte body', () => {
            // A header declaring length 10 carries 4 surplus bytes before the
            // first chunk id. Ignoring the declared length reads "MTrk" from the
            // middle of the header and the whole file parses as zero tracks.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
            ]);
            dispatchParse(toBuffer([...mThdWithTrailer(0, 1, 480, [0x00, 0x00, 0x00, 0x00]), ...track]));
            expect(parsedTracks()).toHaveLength(1);
            expect(firstNote().pitch).toBe(60);
        });
    });

    describe('note on/off pairing (SMF channel-voice messages)', () => {
        it('computes startBeat and duration from note-on / note-off ticks at 480 ppq', () => {
            // Note 60 on at tick 0 (vel 96), off at tick 480 (= 1 beat later).
            // SMF: a single quarter note starting at beat 0, duration 1.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 96, delta: 0 }, // note on
                { status: 0x80, data1: 60, data2: 0, delta: 480 }, // note off (explicit)
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(parsedTracks()).toHaveLength(1);
            const note = firstNote();
            expect(note.pitch).toBe(60);
            expect(note.startBeat).toBe(0); // 0 ticks / 480 ppq
            expect(note.duration).toBe(1); // 480 ticks / 480 ppq
            expect(note.velocity).toBe(96);
        });

        it('treats note-on with velocity 0 as note-off (SMF running optimization)', () => {
            // Spec-permitted: 0x90 data2==0 is functionally a note-off. The
            // parser must pair it with the preceding note-on.
            const track = mTrk([
                { status: 0x90, data1: 64, data2: 80, delta: 0 },
                { status: 0x90, data1: 64, data2: 0, delta: 240 }, // half a beat
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().duration).toBeCloseTo(0.5, 10); // 240/480
        });

        it('emits a clamped min duration when note-on and note-off share the same tick', () => {
            // A zero-tick note would otherwise have duration 0 — inaudible and
            // invisible in the editor. The parser clamps to 0.01 beats.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 0 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().duration).toBe(0.01);
        });

        it('ignores a note-off that has no matching note-on', () => {
            const track = mTrk([{ status: 0x80, data1: 60, data2: 0, delta: 0 }]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            // No note-on ever started -> no notes -> empty track is dropped.
            expect(parsedTracks()).toEqual([]);
        });

        it('closes a note-on that never receives a note-off at the end of the track', () => {
            // A hanging note-on is content the file asked for; the duration is
            // unknown but bounded by the track end. Discarding it loses the note
            // outright. On at tick 0, End-Of-Track at tick 960 -> 2 beats.
            const track = mTrkRaw([...varlen(0), 0x90, 60, 100, ...endOfTrack(960)]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            const note = firstNote();
            expect(note.pitch).toBe(60);
            expect(note.velocity).toBe(100);
            expect(note.startBeat).toBe(0);
            expect(note.duration).toBe(2); // 960 ticks / 480 ppq
        });

        it('pairs same-pitch notes per channel rather than merging them', () => {
            // Format-0 files put every channel in one track. Middle C sounds on
            // channel 0 for 1 beat and on channel 1 for 2 beats, overlapping.
            // Keying active notes on pitch alone pairs channel 1's note-off with
            // channel 0's note-on and loses one note entirely.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 90, delta: 0 }, // ch 0 on @0
                { status: 0x91, data1: 60, data2: 70, delta: 0 }, // ch 1 on @0
                { status: 0x80, data1: 60, data2: 0, delta: 480 }, // ch 0 off @480
                { status: 0x81, data1: 60, data2: 0, delta: 480 }, // ch 1 off @960
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            const notes = firstTrack().notes;
            expect(notes).toHaveLength(2);
            expect(
                notes
                    .map((n) => ({ velocity: n.velocity, duration: n.duration }))
                    .sort((a, b) => a.duration - b.duration)
            ).toEqual([
                { velocity: 90, duration: 1 },
                { velocity: 70, duration: 2 },
            ]);
        });

        it('carries note pitch and velocity but does not duplicate overlapping notes', () => {
            // Two distinct pitches started and stopped; both should survive.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 90, delta: 0 },
                { status: 0x90, data1: 64, data2: 85, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
                { status: 0x80, data1: 64, data2: 0, delta: 480 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(
                firstTrack()
                    .notes.map((n) => n.pitch)
                    .sort()
            ).toEqual([60, 64]);
        });
    });

    describe('running status (SMF §1.4: status reuse)', () => {
        it('reuses the last status byte for a data-byte-first event', () => {
            // Note-on 0x90, then a second chord note reusing 0x90: the first
            // data byte (< 0x80) signals running status.
            const body: number[] = [];
            // delta 0, note-on 60 vel 100
            body.push(...varlen(0), 0x90, 60, 100);
            // delta 0, running status -> data1=64 data2=100 (no status byte)
            body.push(...varlen(0), 64, 100);
            // delta 480, note-off reusing 0x90 with vel 0 for pitch 60
            body.push(...varlen(480), 60, 0);
            // delta 480, note-off reusing 0x90 vel 0 for pitch 64
            body.push(...varlen(480), 64, 0);
            body.push(0x00, 0xff, 0x2f, 0x00); // end of track
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(
                firstTrack()
                    .notes.map((n) => n.pitch)
                    .sort()
            ).toEqual([60, 64]);
        });
    });

    describe('meta events', () => {
        it('captures the track name from meta type 0x03', () => {
            // Track-name meta: 0xff 0x03 len <bytes>. The name is the literal
            // ASCII payload of the meta event. A note is added so the track
            // (which is otherwise empty-of-notes) is still emitted.
            const nameEncoded = Array.from('Bass', (ch) => ch.charCodeAt(0));
            const clean: number[] = [];
            clean.push(...varlen(0), 0xff, 0x03, ...varlen(nameEncoded.length), ...nameEncoded);
            clean.push(...varlen(0), 0x90, 40, 100); // note on
            clean.push(...varlen(120), 0x80, 40, 0); // note off
            clean.push(0x00, 0xff, 0x2f, 0x00); // end of track
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, clean.length), ...clean];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstTrack().name).toBe('Bass');
        });

        it('parses tempo from meta type 0x51 (set-tempo) using micros-per-quarter', () => {
            // 0x51 0x03 with 3 bytes = microseconds per quarter note.
            // BPM = 60_000_000 / mpb. For 100 BPM -> mpb = 600000.
            const mpb = 600000;
            const b1 = (mpb >> 16) & 0xff;
            const b2 = (mpb >> 8) & 0xff;
            const b3 = mpb & 0xff;
            const body: number[] = [];
            body.push(...varlen(0), 0xff, 0x51, 0x03, b1, b2, b3);
            body.push(...varlen(0), 0x90, 60, 100, ...varlen(480), 0x80, 60, 0);
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(lastPosted().tempo).toBe(100); // 60_000_000 / 600000
        });

        it('ignores tempo meta whose length is not 3 bytes', () => {
            // A malformed 0x51 with len != 3 must not corrupt tempo; the default
            // 120 should survive. The payload is still skipped correctly.
            const body: number[] = [];
            body.push(...varlen(0), 0xff, 0x51, 0x02, 0x07, 0xd0); // len 2, not 3
            body.push(...varlen(0), 0x90, 60, 100, ...varlen(480), 0x80, 60, 0);
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(lastPosted().tempo).toBe(120);
        });

        it('keeps the first tempo when the file carries a tempo map', () => {
            // 60_000_000/500000 = 120 at tick 0, then 60_000_000/300000 = 200
            // later. The result protocol carries one tempo; the file starts at
            // 120, so importing at 200 puts every note at the wrong wall time.
            const body: number[] = [];
            body.push(...varlen(0), 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20); // 500000 us
            body.push(...varlen(0), 0x90, 60, 100, ...varlen(480), 0x80, 60, 0);
            body.push(...varlen(0), 0xff, 0x51, 0x03, 0x04, 0x93, 0xe0); // 300000 us
            body.push(...varlen(0), 0x90, 62, 100, ...varlen(480), 0x80, 62, 0);
            body.push(...endOfTrack(0));

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrkRaw(body)]));
            expect(lastPosted().tempo).toBe(120);
        });

        it('decodes a track name with multi-byte UTF-8 characters', () => {
            // SMF meta text is conventionally UTF-8. Latin-1 byte-by-byte
            // decoding turns "Bläser" into "BlÃ¤ser".
            const nameEncoded = Array.from(new TextEncoder().encode('Bläser'));
            const body: number[] = [];
            body.push(...varlen(0), 0xff, 0x03, ...varlen(nameEncoded.length), ...nameEncoded);
            body.push(...varlen(0), 0x90, 40, 100, ...varlen(120), 0x80, 40, 0);
            body.push(...endOfTrack(0));

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrkRaw(body)]));
            expect(firstTrack().name).toBe('Bläser');
        });

        it('skips unknown meta events without misreading subsequent events', () => {
            // An unrecognized meta (e.g. type 0x06 marker text) followed by a
            // real note: the varlen-length skip must land exactly at the next delta.
            const marker = Array.from('LOOP', (ch) => ch.charCodeAt(0));
            const body: number[] = [];
            body.push(...varlen(0), 0xff, 0x06, ...varlen(marker.length), ...marker);
            body.push(...varlen(0), 0x90, 72, 100, ...varlen(480), 0x80, 72, 0);
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().pitch).toBe(72);
        });
    });

    describe('sysex and non-MTrk chunks', () => {
        it('skips sysex escape (0xf0) payloads and continues parsing', () => {
            // Sysex start 0xf0 followed by a varlen byte count and payload.
            // The parser must skip the payload and resume at the next event.
            const body: number[] = [];
            const sysexPayload = [0x7e, 0x00, 0x09, 0x01]; // GM on, identity-style
            body.push(...varlen(0), 0xf0, ...varlen(sysexPayload.length), ...sysexPayload);
            body.push(...varlen(0), 0x90, 60, 100, ...varlen(480), 0x80, 60, 0);
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().pitch).toBe(60);
        });

        it('skips sysex continuation (0xf7) payloads', () => {
            const body: number[] = [];
            body.push(...varlen(0), 0xf7, ...varlen(2), 0xaa, 0xbb);
            body.push(...varlen(0), 0x90, 60, 100, ...varlen(480), 0x80, 60, 0);
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().pitch).toBe(60);
        });

        it('skips a stray system real-time byte without consuming the next event', () => {
            // 0xf8 (timing clock) is illegal inside an MTrk but does occur.
            // Treating it as a status byte reads the following delta as its data
            // byte and desyncs the rest of the track.
            const body: number[] = [];
            body.push(...varlen(0), 0xf8);
            body.push(...varlen(0), 0x90, 60, 100, ...varlen(480), 0x80, 60, 0);
            body.push(...endOfTrack(0));

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrkRaw(body)]));
            const note = firstNote();
            expect(note.pitch).toBe(60);
            expect(note.duration).toBe(1);
        });

        it('skips a system common message together with its data bytes', () => {
            // 0xf3 (song select) carries exactly one data byte. Treating it as a
            // channel-voice status reads two, swallowing the next event's delta.
            const body: number[] = [];
            body.push(...varlen(0), 0xf3, 0x02);
            body.push(...varlen(0), 0x90, 67, 100, ...varlen(240), 0x80, 67, 0);
            body.push(...endOfTrack(0));

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrkRaw(body)]));
            const note = firstNote();
            expect(note.pitch).toBe(67);
            expect(note.duration).toBeCloseTo(0.5, 10);
        });

        it('skips a non-MTrk chunk between tracks without desyncing', () => {
            // A chunk with an unrecognized id ("XXXX") is skipped by its declared
            // length; the subsequent MTrk must still be found and parsed. The note
            // needs a matching note-off so it actually completes and is emitted.
            const junk = [...u32(0x58, 0x58, 0x58, 0x58), ...u32(0, 0, 0, 4), 0xde, 0xad, 0xbe, 0xef];
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 2, 480), ...junk, ...track]));
            expect(parsedTracks()).toHaveLength(1);
            expect(firstNote().pitch).toBe(60);
        });
    });

    describe('program-change and channel-pressure (1-data-byte events)', () => {
        it('reads a single data byte for program-change (0xc0) without desyncing', () => {
            // Program-change and channel-pressure are 1-byte events; the parser
            // must not read a phantom second data byte and shift everything.
            const body: number[] = [];
            body.push(...varlen(0), 0xc0, 0x00); // program change, program 0
            body.push(...varlen(0), 0x90, 60, 100); // note on
            body.push(...varlen(480), 0x80, 60, 0); // note off
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            // If the parser had read a phantom byte for 0xc0, the note-on
            // status would be misread and no note would parse.
            const note = firstNote();
            expect(note.pitch).toBe(60);
            expect(note.duration).toBe(1);
        });

        it('reads a single data byte for channel-pressure (0xd0)', () => {
            const body: number[] = [];
            body.push(...varlen(0), 0xd0, 0x40); // channel pressure
            body.push(...varlen(0), 0x90, 60, 100);
            body.push(...varlen(480), 0x80, 60, 0);
            body.push(0x00, 0xff, 0x2f, 0x00);
            const track = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0, body.length), ...body];

            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().pitch).toBe(60);
        });
    });

    describe('varlen decoding edge cases', () => {
        it('decodes a multi-byte varlen delta correctly (e.g. 192 ticks)', () => {
            // delta of 192 between note-on and note-off -> duration 192/480 = 0.4.
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 192 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            expect(firstNote().duration).toBeCloseTo(0.4, 10);
        });
    });

    describe('malformed input', () => {
        it('keeps the tracks it already parsed when a later chunk length overruns the buffer', () => {
            // A partial download: two intact tracks, then a third whose declared
            // length runs past the end of what arrived.
            const intact = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
            ]);
            const overrunning = [...u32(0x4d, 0x54, 0x72, 0x6b), ...u32(0, 0, 0x01, 0xf4), 0x00, 0xff];
            dispatchParse(toBuffer([...mThd(1, 3, 480), ...intact, ...intact, ...overrunning]));

            const message = lastPosted();
            expect(message.type).toBe('parsed');
            expect(parsedTracks()).toHaveLength(2);
        });

        it('reports a file truncated before its first track instead of parsing zero tracks', () => {
            // A parse that resolves with no tracks is indistinguishable from an
            // empty file, and the importer treats that as nothing to add — so a
            // corrupt drop would produce no tracks and no message at all.
            dispatchParse(toBuffer([...mThd(1, 2, 480), 0x4d, 0x54]));

            const message = lastPosted();
            expect(message.type).toBe('error');
            expect(message.message).toBe('Invalid MIDI file: no readable track data');
        });

        it('keeps the intact tracks when a later track desyncs into an over-long quantity', () => {
            // The bad quantity closes its own track; it must not discard the
            // tracks that already parsed.
            const intact = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
            ]);
            const desynced = mTrkRaw([0xff, 0xff, 0xff, 0xff, 0x7f, 0x90, 60, 100, ...endOfTrack(0)]);
            dispatchParse(toBuffer([...mThd(1, 2, 480), ...intact, ...desynced]));

            expect(parsedTracks()).toHaveLength(1);
        });

        it('refuses a variable-length quantity longer than the four bytes SMF allows', () => {
            // Five continuation bytes overflow a signed 32-bit shift into a
            // negative delta, which places notes before beat 0 where nothing can
            // reach them.
            const body = [0xff, 0xff, 0xff, 0xff, 0x7f, 0x90, 60, 100, ...endOfTrack(0)];
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrkRaw(body)]));

            const message = lastPosted();
            expect(message.type).toBe('error');
        });

        it('does not let a desynced data byte above 127 collide with another channel', () => {
            // `90 80 64` is a note-on whose pitch byte is 128. Unmasked its key
            // is 1 * 128 + 0 — the key channel 1 pitch 0 owns — so the genuine
            // channel 1 note-on below overwrites it and channel 1's note-off
            // closes only one of the two. Both notes must survive.
            const body = [
                0x00,
                0x90,
                0x80,
                0x64, // ch0 note-on, desynced pitch byte 128
                0x00,
                0x91,
                0x00,
                0x64, // ch1 note-on, pitch 0
                0x60,
                0x81,
                0x00,
                0x00, // ch1 note-off, pitch 0
                ...endOfTrack(0),
            ];
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...mTrkRaw(body)]));

            expect(firstTrack().notes).toHaveLength(2);
        });
    });

    describe('note identity', () => {
        it('gives every emitted note a unique string id', () => {
            const track = mTrk([
                { status: 0x90, data1: 60, data2: 100, delta: 0 },
                { status: 0x90, data1: 62, data2: 100, delta: 0 },
                { status: 0x80, data1: 60, data2: 0, delta: 480 },
                { status: 0x80, data1: 62, data2: 0, delta: 480 },
            ]);
            dispatchParse(toBuffer([...mThd(0, 1, 480), ...track]));
            const ids = firstTrack().notes.map((n) => n.id);
            expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });
});
