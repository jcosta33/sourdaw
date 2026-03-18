export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

export type MidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

export type MidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};

export type MidiEvent = MidiNote | MidiCC | MidiPitchBend;

let nextNoteId = 1;
let nextCcId = 1;
let nextPitchBendId = 1;

export const createMidiNote = (pitch: number, startBeat: number, duration: number, velocity = 100): MidiNote => ({
    id: `note-${nextNoteId++}`,
    pitch,
    startBeat,
    duration,
    velocity,
});

export const createMidiCC = (controller: number, value: number, beat: number, channel = 0): MidiCC => ({
    id: `cc-${nextCcId++}`,
    controller,
    value,
    beat,
    channel,
});

export const createMidiPitchBend = (value: number, beat: number, channel = 0): MidiPitchBend => ({
    id: `pb-${nextPitchBendId++}`,
    value,
    beat,
    channel,
});
