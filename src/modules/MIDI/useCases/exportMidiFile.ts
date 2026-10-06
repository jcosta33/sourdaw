import { logger } from '#/infra/logger/appLogger';
import { clampMidiData7, clampVelocity } from '#/utils/midiData';
import { SAME_FRAME_EVENT_ORDER, type SameFrameEventKind } from '#/utils/sameFrameEventOrder';

import { type MidiNote, type MidiCC } from '../models/MidiNote';
import {
    MIDI_FILE_EXTENSION,
    MIDI_FILE_MIME_TYPE,
    SMF_CONTROL_CHANGE_STATUS,
    SMF_META_END_OF_TRACK,
    SMF_META_EVENT,
    SMF_META_TRACK_NAME,
    SMF_NOTE_OFF_STATUS,
    SMF_NOTE_ON_STATUS,
} from '../models/SmfConstants';
import { downloadBlob } from '../repositories/downloadFile';

const TICKS_PER_BEAT = 480;
const VAR_LEN_MAX = 0x0fffffff;

function writeVarLen(value: number): number[] {
    if (value > VAR_LEN_MAX) {
        logger.warn(
            `MIDI export: variable-length quantity ${value} exceeds the 28-bit SMF limit (${VAR_LEN_MAX}) and was truncated`
        );
    }
    const bytes: number[] = [];
    let value1 = value & VAR_LEN_MAX;
    bytes.unshift(value1 & 0x7f);
    while (value1 > 0x7f) {
        value1 >>= 7;
        bytes.unshift((value1 & 0x7f) | 0x80);
    }
    return bytes;
}

function writeString(str: string): number[] {
    const bytes: number[] = [];
    for (let index = 0; index < str.length; index++) {
        bytes.push(str.charCodeAt(index));
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
    kind: SameFrameEventKind;
    data: number[];
};

function buildTrackEvents(notes: MidiNote[], ccs: MidiCC[], clipStartBeat: number, trackName: string): number[] {
    const events: MidiEvent[] = [];

    for (const note of notes) {
        const startTick = Math.round((clipStartBeat + note.startBeat) * TICKS_PER_BEAT);
        const endTick = Math.round((clipStartBeat + note.startBeat + note.duration) * TICKS_PER_BEAT);
        // A note of no ticks is not played. Written, its release would sort ahead
        // of its own start on the shared tick and leave the note held.
        if (endTick <= startTick) {
            continue;
        }
        const vel = clampVelocity(Math.round(note.velocity));
        const pitch = clampMidiData7(note.pitch);
        const channel = (note.channel ?? 0) & 0x0f;

        events.push({ tick: startTick, kind: 'on', data: [SMF_NOTE_ON_STATUS | channel, pitch, vel] });
        events.push({ tick: endTick, kind: 'off', data: [SMF_NOTE_OFF_STATUS | channel, pitch, 0] });
    }

    for (const cc of ccs) {
        const tick = Math.round((clipStartBeat + cc.beat) * TICKS_PER_BEAT);
        const controller = clampMidiData7(cc.controller);
        const value = clampMidiData7(Math.round(cc.value));
        events.push({
            tick,
            kind: 'control',
            data: [SMF_CONTROL_CHANGE_STATUS | ((cc.channel ?? 0) & 0x0f), controller, value],
        });
    }

    // The order playback posts a frame's events in: release, controller, note-on.
    events.sort(
        (left, right) =>
            left.tick - right.tick || SAME_FRAME_EVENT_ORDER[left.kind] - SAME_FRAME_EVENT_ORDER[right.kind]
    );

    const nameBytes = writeString(trackName);
    const trackNameEvent = {
        tick: 0,
        data: [SMF_META_EVENT, SMF_META_TRACK_NAME, ...writeVarLen(nameBytes.length), ...nameBytes],
    };

    const trackBytes: number[] = [];
    let lastTick = 0;
    for (const event of [trackNameEvent, ...events]) {
        const delta = Math.max(0, event.tick - lastTick);
        const deltaBytes = writeVarLen(delta);
        for (let index = 0; index < deltaBytes.length; index++) {
            trackBytes.push(deltaBytes[index]!);
        }
        for (let index = 0; index < event.data.length; index++) {
            trackBytes.push(event.data[index]!);
        }
        lastTick = event.tick;
    }

    const endDelta = writeVarLen(0);
    for (let index = 0; index < endDelta.length; index++) {
        trackBytes.push(endDelta[index]!);
    }
    trackBytes.push(SMF_META_EVENT, SMF_META_END_OF_TRACK, 0x00);

    return trackBytes;
}

type DownloadMidiFileInput = {
    clipName: string;
    clipStartBeat: number;
    notes: MidiNote[];
    ccs: MidiCC[];
};

export function downloadMidiFile({ clipName, clipStartBeat, notes, ccs }: DownloadMidiFileInput): void {
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

    const mtrk = writeString('MTrk');
    const trackLen = write32(trackData.length);
    const trackChunkLen = mtrk.length + trackLen.length + trackData.length;
    const totalLen = headerChunk.length + trackChunkLen;

    const bytes = new Uint8Array(totalLen);
    bytes.set(headerChunk, 0);
    let offset = headerChunk.length;
    bytes.set(mtrk, offset);
    offset += mtrk.length;
    bytes.set(trackLen, offset);
    offset += trackLen.length;
    bytes.set(trackData, offset);

    const sanitizedName = clipName.replaceAll(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
    downloadBlob(bytes, `${sanitizedName}${MIDI_FILE_EXTENSION}`, MIDI_FILE_MIME_TYPE);
}
