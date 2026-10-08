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

// Beats closer than this are one instant: projected beats differ by float noise.
const SAME_BEAT_TOLERANCE = 1e-9;

type MidiEvent = {
    tick: number;
    /** Where the event sits in time before the tick grid rounded it. */
    beat: number;
    kind: SameFrameEventKind;
    /** The pitch and channel of a note event; a controller has none. */
    noteKey?: string;
    data: number[];
};

type SortableEvent = MidiEvent & {
    /** The beat on a grid of tolerance size, so beats a float apart compare equal. */
    sortBeat: number;
    /** Where the event came in the projection order the rows were given in. */
    sequence: number;
};

function snapToBeatGrid(beat: number): number {
    return Math.round(beat / SAME_BEAT_TOLERANCE);
}

/** From the snapped beat, so beats that sort as one instant never straddle a half tick. */
function beatToTick(beat: number): number {
    return Math.round(snapToBeatGrid(beat) * SAME_BEAT_TOLERANCE * TICKS_PER_BEAT);
}

/**
 * A file never strikes a key it releases on the same tick, whatever the beats: the
 * strike takes the sort beat of the latest such release, so the release goes first.
 */
function toSortableEvents(events: MidiEvent[]): SortableEvent[] {
    const latestReleaseByKeyAndTick = new Map<string, number>();
    for (const event of events) {
        if (event.kind !== 'off' || event.noteKey === undefined) {
            continue;
        }
        const releaseId = `${event.tick}|${event.noteKey}`;
        const sortBeat = snapToBeatGrid(event.beat);
        latestReleaseByKeyAndTick.set(
            releaseId,
            Math.max(sortBeat, latestReleaseByKeyAndTick.get(releaseId) ?? sortBeat)
        );
    }
    return events.map((event, sequence) => {
        const sortBeat = snapToBeatGrid(event.beat);
        if (event.kind !== 'on' || event.noteKey === undefined) {
            return { ...event, sortBeat, sequence };
        }
        const releaseSortBeat = latestReleaseByKeyAndTick.get(`${event.tick}|${event.noteKey}`);
        return { ...event, sortBeat: Math.max(sortBeat, releaseSortBeat ?? sortBeat), sequence };
    });
}

function compareDataBytes(left: number[], right: number[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) {
            return left[index]! - right[index]!;
        }
    }
    return left.length - right.length;
}

/**
 * A total order on (tick, sort beat, kind, then a final key), so the same notes write
 * the same bytes whatever order they were stored in. Playback keeps time order across
 * sample frames and applies its release, controller, note-on order only within one
 * frame, so events a tick apart keep their time order whatever their kinds; sort
 * beats on the tolerance grid make beats a float apart one instant, with one tick
 * (both come from the snapped beat). Events equal on
 * all of that are settled last: two controllers keep the order the projection gave
 * them, as playback posts them (a pedal pressed then released at one beat ends up,
 * and an RPN select-then-data sequence stays in sequence); any other pair is ordered
 * by its data bytes, then by that order.
 */
function compareEvents(left: SortableEvent, right: SortableEvent): number {
    if (left.tick !== right.tick) {
        return left.tick - right.tick;
    }
    if (left.sortBeat !== right.sortBeat) {
        return left.sortBeat - right.sortBeat;
    }
    if (left.kind !== right.kind) {
        return SAME_FRAME_EVENT_ORDER[left.kind] - SAME_FRAME_EVENT_ORDER[right.kind];
    }
    if (left.kind === 'control') {
        return left.sequence - right.sequence;
    }
    return compareDataBytes(left.data, right.data) || left.sequence - right.sequence;
}

type TickedNote = {
    startBeat: number;
    endBeat: number;
    startTick: number;
    endTick: number;
    pitch: number;
    velocity: number;
    channel: number;
};

function noteKey(note: Pick<TickedNote, 'pitch' | 'channel'>): string {
    return `${note.channel}:${note.pitch}`;
}

function precedesByBeat(left: TickedNote, right: TickedNote): boolean {
    if (left.startBeat !== right.startBeat) {
        return left.startBeat < right.startBeat;
    }
    if (left.endBeat !== right.endBeat) {
        return left.endBeat < right.endBeat;
    }
    return left.velocity <= right.velocity;
}

/**
 * Sub-tick notes of one key that share a start tick write overlapping one-tick spans,
 * which would strike the key twice; the earliest by beat is the one written, so the
 * result does not depend on the order the notes were stored in.
 */
function collapseSubTickNotes(subTick: TickedNote[]): TickedNote[] {
    const earliestByKeyAndTick = new Map<string, TickedNote>();
    for (const note of subTick) {
        const spanId = `${noteKey(note)}|${note.startTick}`;
        const earliest = earliestByKeyAndTick.get(spanId);
        if (earliest === undefined || !precedesByBeat(earliest, note)) {
            earliestByKeyAndTick.set(spanId, note);
        }
    }
    return [...earliestByKeyAndTick.values()];
}

/**
 * The notes playback sounds, on the tick grid. A note of no duration is not played,
 * nor is a float-noise remainder of a loop wrap, no longer than the tolerance; a note
 * shorter than a tick still is, so it keeps one tick of length.
 *
 * Its one-tick release would cut a note of the same pitch and channel that is
 * sounding at its start tick or struck on it, as the sliver a looped pass leaves
 * before its wrapped tail does at the pass head. The sliver is dropped there: it is
 * shorter than a tick, the other note sounds that pitch at that tick, and writing
 * it could only cut that note or strike it twice. A note struck on the sliver's
 * release tick does not conflict: the release sorts ahead of that strike, so the
 * two never overlap and the sliver is written.
 */
function toTickedNotes(notes: MidiNote[], clipStartBeat: number): TickedNote[] {
    const sounded: TickedNote[] = [];
    const subTick: TickedNote[] = [];
    for (const note of notes) {
        if (!(note.duration > SAME_BEAT_TOLERANCE)) {
            continue;
        }
        const startBeat = clipStartBeat + note.startBeat;
        const endBeat = clipStartBeat + note.startBeat + note.duration;
        const startTick = beatToTick(startBeat);
        const endTick = beatToTick(endBeat);
        const writtenEndTick = Math.max(endTick, startTick + 1);
        const ticked = {
            startBeat,
            endBeat,
            startTick,
            endTick: writtenEndTick,
            pitch: clampMidiData7(note.pitch),
            velocity: clampVelocity(Math.round(note.velocity)),
            channel: (note.channel ?? 0) & 0x0f,
        };
        (endTick > startTick ? sounded : subTick).push(ticked);
    }

    const soundedByKey = new Map<string, TickedNote[]>();
    for (const note of sounded) {
        const sameKey = soundedByKey.get(noteKey(note));
        if (sameKey) {
            sameKey.push(note);
        } else {
            soundedByKey.set(noteKey(note), [note]);
        }
    }
    const survivingSubTick = collapseSubTickNotes(subTick).filter((sliver) => {
        const sameKey = soundedByKey.get(noteKey(sliver)) ?? [];
        return !sameKey.some((other) => other.startTick < sliver.endTick && other.endTick > sliver.startTick);
    });
    return [...sounded, ...survivingSubTick];
}

function buildTrackEvents(notes: MidiNote[], ccs: MidiCC[], clipStartBeat: number, trackName: string): number[] {
    const events: MidiEvent[] = [];

    for (const note of toTickedNotes(notes, clipStartBeat)) {
        events.push({
            tick: note.startTick,
            beat: note.startBeat,
            kind: 'on',
            noteKey: noteKey(note),
            data: [SMF_NOTE_ON_STATUS | note.channel, note.pitch, note.velocity],
        });
        events.push({
            tick: note.endTick,
            beat: note.endBeat,
            kind: 'off',
            noteKey: noteKey(note),
            data: [SMF_NOTE_OFF_STATUS | note.channel, note.pitch, 0],
        });
    }

    for (const cc of ccs) {
        const beat = clipStartBeat + cc.beat;
        const controller = clampMidiData7(cc.controller);
        const value = clampMidiData7(Math.round(cc.value));
        events.push({
            tick: beatToTick(beat),
            beat,
            kind: 'control',
            data: [SMF_CONTROL_CHANGE_STATUS | ((cc.channel ?? 0) & 0x0f), controller, value],
        });
    }

    const sortedEvents = toSortableEvents(events).sort(compareEvents);

    const nameBytes = writeString(trackName);
    const trackNameEvent = {
        tick: 0,
        data: [SMF_META_EVENT, SMF_META_TRACK_NAME, ...writeVarLen(nameBytes.length), ...nameBytes],
    };

    const trackBytes: number[] = [];
    let lastTick = 0;
    for (const event of [trackNameEvent, ...sortedEvents]) {
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
