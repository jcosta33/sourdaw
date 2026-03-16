import { trackStore } from "../stores/trackStore";
import { midiStore } from "../stores/midiStore";
import type { MidiNote, MidiCC } from "../models/MidiNote";

const TICKS_PER_BEAT = 480;

const writeVarLen = (value: number): number[] => {
    const bytes: number[] = [];
    let v = value & 0x0FFFFFFF;
    bytes.unshift(v & 0x7F);
    while (v > 0x7F) {
        v >>= 7;
        bytes.unshift((v & 0x7F) | 0x80);
    }
    return bytes;
};

const writeString = (str: string): number[] => {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i));
    }
    return bytes;
};

const write32 = (value: number): number[] => [
    (value >> 24) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF,
];

const write16 = (value: number): number[] => [
    (value >> 8) & 0xFF,
    value & 0xFF,
];

type MidiEvent = {
    tick: number;
    data: number[];
};

const buildTrackEvents = (
    notes: MidiNote[],
    ccs: MidiCC[],
    clipStartBeat: number,
    trackName: string,
): number[] => {
    const events: MidiEvent[] = [];

    const nameBytes = writeString(trackName);
    events.push({
        tick: 0,
        data: [0xFF, 0x03, ...writeVarLen(nameBytes.length), ...nameBytes],
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
        events.push({ tick, data: [0xB0 | ((cc.channel ?? 0) & 0x0F), controller, value] });
    }

    events.sort((a, b) => a.tick - b.tick);

    const trackBytes: number[] = [];
    let lastTick = 0;
    for (const event of events) {
        const delta = Math.max(0, event.tick - lastTick);
        trackBytes.push(...writeVarLen(delta), ...event.data);
        lastTick = event.tick;
    }

    trackBytes.push(...writeVarLen(0), 0xFF, 0x2F, 0x00);

    return trackBytes;
};

export const exportMidiClip = (clipId: string): void => {
    const trackState = trackStore.value;
    const midi = midiStore.value;
    if (!trackState || !midi) {
        return;
    }

    let clipName = "export";
    let clipStartBeat = 0;
    for (const track of trackState.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            clipName = clip.name || track.name;
            clipStartBeat = 0;
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
        ...writeString("MThd"),
        ...write32(6),
        ...write16(0),
        ...write16(1),
        ...write16(TICKS_PER_BEAT),
    ];

    const trackChunk = [
        ...writeString("MTrk"),
        ...write32(trackData.length),
        ...trackData,
    ];

    const bytes = new Uint8Array([...headerChunk, ...trackChunk]);
    const blob = new Blob([bytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clipName.replace(/[^a-zA-Z0-9_-]/g, "_")}.mid`;
    a.click();
    URL.revokeObjectURL(url);
};
