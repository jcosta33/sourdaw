export type MidiInputInfo = {
    id: string;
    name: string;
    manufacturer: string;
};

/**
 * The only two fields this module ever reads off an inbound MIDI message.
 *
 * Web MIDI delivers a real `MIDIMessageEvent`, which satisfies this shape; the
 * Tauri bridge has no DOM event to deliver and used to fabricate one with a
 * cast, producing an object that claimed `target`, `currentTarget`,
 * `preventDefault` and the rest while carrying none of them (issue #1837 F8).
 * Naming what is actually consumed lets both sources be honest.
 */
export type WebMidiInputMessage = {
    data: Uint8Array | null;
    /**
     * DOMHighResTimeStamp on the `performance.now()` origin. `undefined` when
     * the source has no usable arrival time — the native bridge can fail to
     * map midir's stamp, and a message with no arrival time must still be
     * delivered.
     */
    timeStamp: number | undefined;
};

export type MidiLearnState = {
    active: boolean;
    callback: ((cc: number, channel: number) => void) | null;
};

export type WebMidiState = {
    isSupported: boolean;
    inputs: MidiInputInfo[];
    selectedInputId: string | null;
};

export type WebMidiNoteKey = `${number}:${number}`;

export function createWebMidiNoteKey(channel: number, note: number): WebMidiNoteKey {
    return `${channel}:${note}`;
}

export type ToasterNoteRoute = {
    deviceId: string;
    pad: number;
};

export type ActiveNoteData = {
    startTime: number;
    startBeat: number;
    channel: number;
    note: number;
    /** Played note-on velocity, captured so recording preserves dynamics (M-143). */
    velocity?: number;
    /** Track that originated the note; selection changes must not retarget release. */
    trackId: string;
    /** Instrument owner resolved at note-on; source-track changes must not retarget release. */
    instrumentTrackId: string;
    /** Stable runtime identity carried through the Yeast note-on/note-off pair. */
    noteInstanceId?: string;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /**
     * Semitone range the captured `pitchBend` was performed against (audit
     * MD-8), so recording can persist the depth the player actually heard
     * instead of leaving playback to guess.
     */
    pitchBendRangeSemitones?: number;
    osc?: OscillatorNode & { _env?: GainNode };
    /** When the note was sent to a Fermenter instance, stores the device ID for noteOff routing */
    fermenterDeviceId?: string;
    /** Exact Toaster device and child pad that accepted the note. */
    toasterRoute?: ToasterNoteRoute;
    /** When the note was sent to a Grand Boule instance, stores the device ID for noteOff routing */
    grandBouleDeviceId?: string;
    /** When the note was sent to a Levain instance, stores the device ID for noteOff routing */
    levainDeviceId?: string;
};

// MIDI message constants
export const MIDI_NOTE_ON = 0x90;
export const MIDI_NOTE_OFF = 0x80;
export const MIDI_CC = 0xb0;
export const MIDI_PITCH_BEND = 0xe0;
export const MIDI_CHANNEL_PRESSURE = 0xd0;
export const MPE_SLIDE_CC = 74;
