import { inject } from '#/infra/di/inject';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { midiStore } from '../stores/midiStore';
import { downloadBlob } from '../repositories/downloadFile';
import { type MidiNote, type MidiCC } from '../models/MidiNote';

const TICKS_PER_BEAT = 480;

function writeVarLen(value: number): number[] {
    const bytes: number[] = [];
    let v = value & 0x0fffffff;
    bytes.unshift(v & 0x7f);
    while (v > 0x7f) {
        v >>= 7;
        bytes.unshift((v & 0x7f) | 0x80);
    }
    return bytes;
}

function writeString(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i));
    }
    return bytes;
}

function write32(value: number): number[] {
    return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function write16(value: number): number[] {
    return [(value >> 8) & 0xff, value & 0xff];
}

type MidiEvent = {
    tick: number;
    data: number[];
};

function buildTrackEvents(notes: MidiNote[], ccs: MidiCC[], clipStartBeat: number, trackName: string): number[] {
    const events: MidiEvent[] = [];

    const nameBytes = writeString(trackName);
    events.push({
        tick: 0,
        data: [0xff, 0x03, ...writeVarLen(nameBytes.length), ...nameBytes],
    });

    for (const note of notes) {
        const startTick = Math.round((clipStartBeat + note.startBeat) * TICKS_PER_BEAT);
        const endTick = Math.round((clipStartBeat + note.startBeat + note.duration) * TICKS_PER_BEAT);
        const vel = Math.max(1, Math.min(127, Math.round(note.velocity)));
        const pitch = Math.max(0, Math.min(127, note.pitch));

        events.push({ tick: startTick, data: [0x90, pitch, vel] });
        events.push({ tick: endTick, data: [0x80, pitch, 0] });
    }

    for (const cc of ccs) {
        const tick = Math.round((clipStartBeat + cc.beat) * TICKS_PER_BEAT);
        const controller = Math.max(0, Math.min(127, cc.controller));
        const value = Math.max(0, Math.min(127, Math.round(cc.value)));
        events.push({ tick, data: [0xb0 | ((cc.channel ?? 0) & 0x0f), controller, value] });
    }

    events.sort((a, b) => a.tick - b.tick);

    const trackBytes: number[] = [];
    let lastTick = 0;
    for (const event of events) {
        const delta = Math.max(0, event.tick - lastTick);
        trackBytes.push(...writeVarLen(delta), ...event.data);
        lastTick = event.tick;
    }

    trackBytes.push(...writeVarLen(0), 0xff, 0x2f, 0x00);

    return trackBytes;
}

export const exportMidiClip = inject({ downloadBlob })(
    ({ downloadBlob }) =>
        function exportMidiClip(clipId: string): void {
            const tracks = getAllTracks();
            const midi = midiStore.value;
            if (tracks.length === 0 || !midi) {
                return;
            }

            let clipName = 'export';
            const clipStartBeat = 0;
            for (const track of tracks) {
                const clip = track.clips.find((c) => c.id === clipId);
                if (clip) {
                    clipName = clip.name || track.name;
                    break;
                }
            }

            const notes = midi.notesByClipId[clipId] ?? [];
            const ccs = midi.ccByClipId[clipId] ?? [];

            if (notes.length === 0 && ccs.length === 0) {
                return;
            }

            const trackData = buildTrackEvents(notes, ccs, clipStartBeat, clipName);

            const headerChunk = [
                ...writeString('MThd'),
                ...write32(6),
                ...write16(0),
                ...write16(1),
                ...write16(TICKS_PER_BEAT),
            ];

            const trackChunk = [...writeString('MTrk'), ...write32(trackData.length), ...trackData];

            const bytes = new Uint8Array([...headerChunk, ...trackChunk]);
            const sanitizedName = clipName.replaceAll(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
            downloadBlob(bytes, `${sanitizedName}.mid`, 'audio/midi');
        }
);
