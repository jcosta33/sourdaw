import { trackStore } from "../stores/trackStore";
import { midiStore } from "../stores/midiStore";
import { createTrack } from "../models/Track";
import { addClip } from "./clipUseCases";
import type { MidiNote } from "../models/MidiNote";

type ParsedTrack = {
    name: string;
    notes: MidiNote[];
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
        let s = "";
        for (let i = 0; i < len; i++) s += String.fromCharCode(this.readUint8());
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

const parseMidiFile = (buffer: ArrayBuffer): { tracks: ParsedTrack[]; ticksPerBeat: number; tempo: number } => {
    const reader = new MidiReader(buffer);

    const headerChunk = reader.readString(4);
    if (headerChunk !== "MThd") throw new Error("Not a valid MIDI file");

    reader.readUint32(); // header length
    const format = reader.readUint16();
    const numTracks = reader.readUint16();
    const ticksPerBeat = reader.readUint16();

    if (format > 1) throw new Error(`MIDI format ${format} not supported`);

    let globalTempo = 120;
    const parsedTracks: ParsedTrack[] = [];

    for (let t = 0; t < numTracks; t++) {
        const chunkType = reader.readString(4);
        const chunkLength = reader.readUint32();

        if (chunkType !== "MTrk") {
            reader.skip(chunkLength);
            continue;
        }

        const chunkEnd = reader.position + chunkLength;
        let trackName = `Track ${t + 1}`;
        const activeNotes = new Map<number, { tick: number; velocity: number }>();
        const notes: MidiNote[] = [];
        let tick = 0;
        let runningStatus = 0;
        let noteId = 0;

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
                // program change / channel pressure: 1 data byte only
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
                        id: `imp-${t}-${noteId++}`,
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
};

export const importMidiFile = async (file: File): Promise<void> => {
    const buffer = await file.arrayBuffer();
    const { tracks: parsedTracks } = parseMidiFile(buffer);

    if (parsedTracks.length === 0) return;

    const state = trackStore.value;
    if (!state) return;

    const newMidiData: Record<string, MidiNote[]> = { ...(midiStore.value?.notesByClipId ?? {}) };

    const createdTracks = parsedTracks.map((parsed) => ({
        track: createTrack({ name: parsed.name, kind: "midi" }),
        parsed,
    }));

    const ts = trackStore.value;
    if (ts) {
        trackStore.set({
            ...ts,
            tracks: [...ts.tracks, ...createdTracks.map((ct) => ct.track)],
        });
    }

    for (const { track, parsed } of createdTracks) {
        const maxBeat = Math.max(...parsed.notes.map((n) => n.startBeat + n.duration), 4);
        const endBeat = Math.ceil(maxBeat / 4) * 4;

        const clip = addClip({
            trackId: track.id,
            startBeat: 0,
            endBeat,
            name: parsed.name,
            type: "midi",
        });

        if (clip) {
            newMidiData[clip.id] = parsed.notes;
        }
    }

    midiStore.set({
        notesByClipId: newMidiData,
        ccByClipId: midiStore.value?.ccByClipId ?? {},
        pitchBendByClipId: midiStore.value?.pitchBendByClipId ?? {},
    });
};
