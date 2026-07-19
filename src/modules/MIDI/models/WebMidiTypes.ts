export type MidiInputInfo = {
    id: string;
    name: string;
    manufacturer: string;
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
    /** Track that originated the note; selection changes must not retarget release. */
    trackId: string;
    /** Instrument owner resolved at note-on; source-track changes must not retarget release. */
    instrumentTrackId: string;
    /** Stable runtime identity carried through a Yeast note-on/note-off pair. */
    noteInstanceId?: string;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
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
