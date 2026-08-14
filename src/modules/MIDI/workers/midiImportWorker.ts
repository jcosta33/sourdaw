/// <reference lib="webworker" />
/**
 * MIDI import worker — offloads the synchronous .mid parse onto a background
 * thread so the UI stays responsive while parsing large files. §159.1.
 *
 * Port protocol (self.onmessage):
 *   ← { type: 'parse', buffer: ArrayBuffer }                        (transferable)
 *   → { type: 'parsed', tracks: ParsedTrack[], ticksPerBeat, tempo } | { type: 'error', message }
 */

type ParsedNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

type ParsedTrack = {
    name: string;
    notes: ParsedNote[];
    endTick: number;
};

const MAX_VAR_LEN_BYTES = 4;
const CHUNK_HEADER_BYTES = 8;

class MidiReader {
    private data: DataView;
    private pos = 0;

    constructor(buffer: ArrayBuffer) {
        this.data = new DataView(buffer);
    }

    readUint8(): number {
        return this.data.getUint8(this.pos++);
    }

    readUint16(): number {
        const value = this.data.getUint16(this.pos);
        this.pos += 2;
        return value;
    }

    readUint32(): number {
        const value = this.data.getUint32(this.pos);
        this.pos += 4;
        return value;
    }

    /**
     * SMF meta text (track names, markers) is conventionally UTF-8. Decoding
     * byte-by-byte through `String.fromCharCode` is Latin-1 and garbles every
     * multi-byte name. Chunk ids ('MThd', 'MTrk') are ASCII, which UTF-8 is a
     * superset of, so the same reader serves both.
     */
    readString(len: number): string {
        const bytes = new Uint8Array(this.data.buffer, this.data.byteOffset + this.pos, len);
        this.pos += len;
        return new TextDecoder().decode(bytes);
    }

    /**
     * SMF caps a variable-length quantity at four bytes (28 bits). Reading a
     * fifth continuation byte shifts past bit 31, so `<<` turns the delta
     * negative and places notes before beat 0 where nothing can reach them.
     * Multiplying keeps the value off the sign bit.
     *
     * A fifth byte means the stream desynced, so the rest of this track is
     * unreadable. Raise the same `RangeError` a read off the end raises: the
     * track closes on what it already read and the other tracks still import.
     */
    readVarLen(): number {
        let value = 0;
        let byte: number;
        let bytesRead = 0;
        do {
            if (bytesRead === MAX_VAR_LEN_BYTES) {
                throw new RangeError('variable-length quantity exceeds the four bytes SMF allows');
            }
            byte = this.readUint8();
            bytesRead++;
            value = value * 128 + (byte & 0x7f);
        } while (byte & 0x80);
        return value;
    }

    skip(node: number): void {
        this.pos += node;
    }

    seek(position: number): void {
        this.pos = position;
    }

    get position(): number {
        return this.pos;
    }

    get length(): number {
        return this.data.byteLength;
    }
}

const DEFAULT_TEMPO_BPM = 120;
const MIN_NOTE_DURATION_BEATS = 0.01;
const PITCHES_PER_CHANNEL = 128;

/**
 * Active notes are keyed by channel *and* pitch. Keying on pitch alone
 * mis-pairs durations whenever the same pitch sounds on two channels at once —
 * routine in format-0 files, where every channel shares one track.
 */
function activeNoteKey(channel: number, pitch: number): number {
    return channel * PITCHES_PER_CHANNEL + pitch;
}

/**
 * Data-byte count for the System Common messages. These are illegal inside an
 * MTrk chunk, but a real file that carries one must not have it swallowed as
 * channel data — that desyncs the byte stream for the rest of the track.
 */
function systemCommonDataByteCount(statusByte: number): number {
    if (statusByte === 0xf2) {
        return 2;
    }
    if (statusByte === 0xf1 || statusByte === 0xf3) {
        return 1;
    }
    return 0;
}

function parseMidiFile(buffer: ArrayBuffer): { tracks: ParsedTrack[]; ticksPerBeat: number; tempo: number } {
    const reader = new MidiReader(buffer);

    const headerChunk = reader.readString(4);
    if (headerChunk !== 'MThd') {
        throw new Error('Not a valid MIDI file');
    }

    const headerLength = reader.readUint32();
    const headerBodyStart = reader.position;
    const format = reader.readUint16();
    const numTracks = reader.readUint16();
    const division = reader.readUint16();
    // SMF 1.0 fixes the header body at 6 bytes but permits longer headers, whose
    // trailing bytes a reader must skip. Without this the first chunk id is read
    // from the middle of the header and every track is lost.
    reader.skip(Math.max(0, headerLength - (reader.position - headerBodyStart)));

    if (format > 1) {
        throw new Error(`MIDI format ${format} not supported`);
    }

    // Bit 15 of the division word selects SMPTE (frames/second) timing instead
    // of ticks-per-quarter-note. Reading it as PPQN yields meaningless beats.
    if ((division & 0x8000) !== 0) {
        throw new Error('SMPTE-encoded MIDI timing is not supported');
    }
    // A zero division would make every startBeat and duration Infinity.
    if (division === 0) {
        throw new Error('Invalid MIDI file: zero ticks per beat');
    }
    const ticksPerBeat = division;

    let globalTempo = DEFAULT_TEMPO_BPM;
    // The result protocol carries a single tempo, so a tempo map has to collapse.
    // Collapsing to the *first* tempo keeps the value the file starts at;
    // collapsing to the last imported the file at whatever tempo happened to
    // appear last in the map.
    let tempoResolved = false;
    const parsedTracks: ParsedTrack[] = [];
    // Set whenever the file gave up less than it declared. It decides only
    // whether an empty result is an empty file or an unreadable one; a partial
    // result is still the notes the file asked for and is imported as-is.
    let lostTrackData = false;

    for (let time = 0; time < numTracks; time++) {
        // The header's track count is a claim about a file that may have been
        // truncated in transit. Reading a chunk id past the end throws out of
        // the whole parse and loses every track already read, so stop here and
        // return what did arrive.
        if (reader.length - reader.position < CHUNK_HEADER_BYTES) {
            lostTrackData = true;
            break;
        }

        const chunkType = reader.readString(4);
        const chunkLength = reader.readUint32();

        if (chunkType !== 'MTrk') {
            reader.skip(chunkLength);
            continue;
        }

        // A declared length that overruns the buffer must not become a read
        // bound; clamp it so the event loop below stops at real data.
        const chunkEnd = Math.min(reader.position + chunkLength, reader.length);
        let trackName = `Track ${time + 1}`;
        const activeNotes = new Map<number, { tick: number; velocity: number }>();
        const notes: ParsedNote[] = [];
        let tick = 0;
        let runningStatus = 0;

        try {
            while (reader.position < chunkEnd) {
                const delta = reader.readVarLen();
                tick += delta;

                let statusByte = reader.readUint8();

                if (statusByte === 0xff) {
                    const metaType = reader.readUint8();
                    const metaLen = reader.readVarLen();
                    const metaStart = reader.position;

                    if (metaType === 0x03) {
                        trackName = reader.readString(metaLen);
                    } else if (metaType === 0x51 && metaLen === 3) {
                        const microsPerBeat =
                            (reader.readUint8() << 16) | (reader.readUint8() << 8) | reader.readUint8();
                        if (!tempoResolved && microsPerBeat > 0) {
                            globalTempo = Math.round(60_000_000 / microsPerBeat);
                            tempoResolved = true;
                        }
                    }

                    reader.skip(Math.max(0, metaLen - (reader.position - metaStart)));
                    continue;
                }

                if (statusByte === 0xf0 || statusByte === 0xf7) {
                    const sysexLen = reader.readVarLen();
                    reader.skip(sysexLen);
                    continue;
                }

                // Everything left at or above 0xf1 is System Common or System
                // Real-Time. Adopting one as running status and then reading a data
                // byte for it consumes the next event's delta time.
                if (statusByte >= 0xf1) {
                    reader.skip(systemCommonDataByteCount(statusByte));
                    if (statusByte <= 0xf6) {
                        runningStatus = 0; // System Common cancels running status.
                    }
                    continue;
                }

                let data1: number;
                let data2: number;

                if (statusByte >= 0x80) {
                    runningStatus = statusByte;
                    data1 = reader.readUint8();
                } else {
                    if (runningStatus === 0) {
                        // A data byte with no established status byte cannot be
                        // interpreted; consuming operands for it would desync.
                        continue;
                    }
                    data1 = statusByte;
                    statusByte = runningStatus;
                }

                const eventType = statusByte & 0xf0;

                if (eventType === 0xc0 || eventType === 0xd0) {
                    data2 = 0;
                } else {
                    data2 = reader.readUint8();
                }

                const channel = statusByte & 0x0f;
                // A data byte is seven bits. A desynced stream can put 128 here, and
                // an unmasked 128 keys to `channel + 1` pitch 0 — so the phantom note
                // collides with a genuine note one channel up and one of the two is
                // never closed.
                const pitch = data1 & 0x7f;
                const key = activeNoteKey(channel, pitch);

                if (eventType === 0x90 && data2 > 0) {
                    activeNotes.set(key, { tick, velocity: data2 });
                } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
                    const start = activeNotes.get(key);
                    if (start) {
                        notes.push({
                            id: crypto.randomUUID(),
                            pitch,
                            startBeat: start.tick / ticksPerBeat,
                            duration: Math.max(MIN_NOTE_DURATION_BEATS, (tick - start.tick) / ticksPerBeat),
                            velocity: start.velocity,
                        });
                        activeNotes.delete(key);
                    }
                }
            }
        } catch (error) {
            // The last event of a truncated file runs off the end of the
            // buffer, and a desynced stream produces an over-long
            // variable-length quantity. Both arrive as a `RangeError`, and the
            // notes read before one are still the notes the file asked for — so
            // close the track here. Anything else is a real parse failure.
            if (!(error instanceof RangeError)) {
                throw error;
            }
            lostTrackData = true;
        }

        // A note-on with no matching note-off is still a note the file asked
        // for; close it at the end of the track rather than discarding it.
        for (const [key, start] of activeNotes) {
            notes.push({
                id: crypto.randomUUID(),
                pitch: key % PITCHES_PER_CHANNEL,
                startBeat: start.tick / ticksPerBeat,
                duration: Math.max(MIN_NOTE_DURATION_BEATS, (tick - start.tick) / ticksPerBeat),
                velocity: start.velocity,
            });
        }
        activeNotes.clear();

        // Resynchronise on the declared chunk length so a track that reads long
        // or short cannot carry its desync into the next chunk id.
        reader.seek(chunkEnd);

        if (notes.length > 0) {
            parsedTracks.push({ name: trackName, notes, endTick: tick });
        }
    }

    // Recovering nothing from a file that lost data is a corrupt file, not an
    // empty one. Resolving it as a parse with zero tracks makes the import a
    // silent no-op: the caller treats an empty result as "nothing to add" and
    // says nothing, so the user drops a broken .mid and sees no response at all.
    if (lostTrackData && parsedTracks.length === 0) {
        throw new Error('Invalid MIDI file: no readable track data');
    }

    return { tracks: parsedTracks, ticksPerBeat, tempo: globalTempo };
}

self.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type: 'parse'; buffer: ArrayBuffer };
    if (msg.type !== 'parse') {
        return;
    }
    try {
        const result = parseMidiFile(msg.buffer);
        self.postMessage({ type: 'parsed', ...result });
    } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
