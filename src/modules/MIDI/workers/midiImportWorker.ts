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
        const v = this.data.getUint16(this.pos);
        this.pos += 2;
        return v;
    }

    readUint32(): number {
        const v = this.data.getUint32(this.pos);
        this.pos += 4;
        return v;
    }

    readString(len: number): string {
        let s = '';
        for (let i = 0; i < len; i++) {
            s += String.fromCharCode(this.readUint8());
        }
        return s;
    }

    readVarLen(): number {
        let value = 0;
        let byte: number;
        do {
            byte = this.readUint8();
            value = (value << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        return value;
    }

    skip(n: number): void {
        this.pos += n;
    }

    get position(): number {
        return this.pos;
    }

    get length(): number {
        return this.data.byteLength;
    }
}

function parseMidiFile(buffer: ArrayBuffer): { tracks: ParsedTrack[]; ticksPerBeat: number; tempo: number } {
    const reader = new MidiReader(buffer);

    const headerChunk = reader.readString(4);
    if (headerChunk !== 'MThd') {
        throw new Error('Not a valid MIDI file');
    }

    reader.readUint32(); // header length
    const format = reader.readUint16();
    const numTracks = reader.readUint16();
    const ticksPerBeat = reader.readUint16();

    if (format > 1) {
        throw new Error(`MIDI format ${format} not supported`);
    }

    let globalTempo = 120;
    const parsedTracks: ParsedTrack[] = [];

    for (let t = 0; t < numTracks; t++) {
        const chunkType = reader.readString(4);
        const chunkLength = reader.readUint32();

        if (chunkType !== 'MTrk') {
            reader.skip(chunkLength);
            continue;
        }

        const chunkEnd = reader.position + chunkLength;
        let trackName = `Track ${t + 1}`;
        const activeNotes = new Map<number, { tick: number; velocity: number }>();
        const notes: ParsedNote[] = [];
        let tick = 0;
        let runningStatus = 0;

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
                    const microsPerBeat = (reader.readUint8() << 16) | (reader.readUint8() << 8) | reader.readUint8();
                    globalTempo = Math.round(60_000_000 / microsPerBeat);
                }

                reader.skip(Math.max(0, metaLen - (reader.position - metaStart)));
                continue;
            }

            if (statusByte === 0xf0 || statusByte === 0xf7) {
                const sysexLen = reader.readVarLen();
                reader.skip(sysexLen);
                continue;
            }

            let data1: number;
            let data2: number;

            if (statusByte >= 0x80) {
                runningStatus = statusByte;
                data1 = reader.readUint8();
            } else {
                data1 = statusByte;
                statusByte = runningStatus;
            }

            const eventType = statusByte & 0xf0;

            if (eventType === 0xc0 || eventType === 0xd0) {
                data2 = 0;
            } else {
                data2 = reader.readUint8();
            }

            if (eventType === 0x90 && data2 > 0) {
                activeNotes.set(data1, { tick, velocity: data2 });
            } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
                const start = activeNotes.get(data1);
                if (start) {
                    const startBeat = start.tick / ticksPerBeat;
                    const duration = (tick - start.tick) / ticksPerBeat;
                    notes.push({
                        id: crypto.randomUUID(),
                        pitch: data1,
                        startBeat,
                        duration: Math.max(0.01, duration),
                        velocity: start.velocity,
                    });
                    activeNotes.delete(data1);
                }
            }
        }

        if (notes.length > 0) {
            parsedTracks.push({ name: trackName, notes, endTick: tick });
        }
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
