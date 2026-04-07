import { createMidiError } from '../errors/MidiError';
import { getTrackStoreState as getTrackState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { setTrackState } from '#/modules/Arrangement/useCases/setTrackState';
import { midiStore } from '../stores/midiStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { createTrack } from '#/modules/Arrangement/useCases/createTrack';
import { getNextClipId } from '#/modules/Arrangement/useCases/getNextClipId';
import { type Clip } from '../models/TrackViewTypes';
import { type MidiNote } from '../models/MidiNote';
import { pushUndo } from '#/modules/Command/stores/undoStore';
import { createCallbackUndoEntry } from '#/modules/Command/useCases/commandQueries';

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
        throw createMidiError('Not a valid MIDI file');
    }

    reader.readUint32(); // header length
    const format = reader.readUint16();
    const numTracks = reader.readUint16();
    const ticksPerBeat = reader.readUint16();

    if (format > 1) {
        throw createMidiError(`MIDI format ${format} not supported`);
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
}

export async function importMidiFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    // Yield to the event loop before the synchronous parse so that any pending
    // UI work (e.g. a drag-and-drop visual update) can complete first.
    // The parse itself remains on the main thread; a Web Worker is the full fix.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const { tracks: parsedTracks } = parseMidiFile(buffer);

    if (parsedTracks.length === 0) {
        return;
    }

    const state = getTrackState();
    if (!state) {
        return;
    }

    const trackSnapshotBefore = structuredClone(trackStore.value);
    const midiSnapshotBefore = structuredClone(midiStore.value);

    const newMidiData: Record<string, MidiNote[]> = { ...(midiStore.value?.notesByClipId ?? {}) };

    // Build all tracks with their clips in-memory so we can commit everything
    // in a single setTrackState() call instead of calling addClip() (→ updateTrack()
    // → trackStore.set()) once per imported track.
    const tracksWithClips = parsedTracks.map((parsed) => {
        const track = createTrack({ name: parsed.name, kind: 'midi' });
        const maxBeat = Math.max(...parsed.notes.map((n) => n.startBeat + n.duration), 4);
        const endBeat = Math.ceil(maxBeat / 4) * 4;
        const clip: Clip = {
            id: getNextClipId(),
            trackId: track.id,
            name: parsed.name,
            startBeat: 0,
            endBeat,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1.0,
            color: '',
            locked: false,
            muted: false,
        };
        newMidiData[clip.id] = parsed.notes;
        return { ...track, clips: [clip] };
    });

    const ts = getTrackState();
    if (ts) {
        setTrackState({
            ...ts,
            tracks: [...ts.tracks, ...tracksWithClips],
        });
    }

    midiStore.set({
        notesByClipId: newMidiData,
        ccByClipId: midiStore.value?.ccByClipId ?? {},
        pitchBendByClipId: midiStore.value?.pitchBendByClipId ?? {},
    });

    const trackSnapshotAfter = structuredClone(trackStore.value);
    const midiSnapshotAfter = structuredClone(midiStore.value);

    const name =
        parsedTracks.length === 1 ? (parsedTracks[0]?.name ?? 'MIDI file') : `${parsedTracks.length} MIDI tracks`;
    pushUndo(
        createCallbackUndoEntry(
            `Import MIDI: ${name}`,
            () => {
                if (trackSnapshotBefore) {
                    trackStore.set(trackSnapshotBefore);
                }
                if (midiSnapshotBefore) {
                    midiStore.set(midiSnapshotBefore);
                }
            },
            () => {
                if (trackSnapshotAfter) {
                    trackStore.set(trackSnapshotAfter);
                }
                if (midiSnapshotAfter) {
                    midiStore.set(midiSnapshotAfter);
                }
            }
        )
    );
}
