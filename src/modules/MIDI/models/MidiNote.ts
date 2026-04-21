export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
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

export function createMidiNote(
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100,
    probability = 100
): MidiNote {
    return {
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        pitch,
        startBeat,
        duration,
        velocity,
        probability,
    };
}

export function createMidiCC(controller: number, value: number, beat: number, channel = 0): MidiCC {
    return {
        id: `cc-${crypto.randomUUID().slice(0, 8)}`,
        controller,
        value,
        beat,
        channel,
    };
}

export function createMidiPitchBend(value: number, beat: number, channel = 0): MidiPitchBend {
    return {
        id: `pb-${crypto.randomUUID().slice(0, 8)}`,
        value,
        beat,
        channel,
    };
}
