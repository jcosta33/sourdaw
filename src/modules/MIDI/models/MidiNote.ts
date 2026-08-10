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
    /**
     * Semitone range `pitchBend` was performed against (audit MD-8).
     *
     * `pitchBend` is the raw 14-bit wire delta and carries no depth of its own:
     * -4096 means one thing on a controller set to ±2 and something twelve
     * times deeper on one set to ±48. Recording the range alongside it is what
     * makes playback sound at the depth it was played.
     *
     * Optional, and absent means the MPE member default of ±48 semitones —
     * which is exactly what every recording made before RPN 0 was decoded was
     * captured under, so existing notes keep sounding as they always have.
     */
    pitchBendRangeSemitones?: number;
    channel?: number;
    /** Per-note performance articulation (for example staccato, accent, or legato). */
    articulation?: string;
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

export function isValidMidiArticulation(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value !== value.trim()) {
        return false;
    }
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
            return false;
        }
    }
    return true;
}

export function createMidiNote(
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100,
    probability = 100
): MidiNote {
    return {
        id: `note-${crypto.randomUUID()}`,
        pitch,
        startBeat,
        duration,
        velocity,
        probability,
    };
}

export function createMidiCC(controller: number, value: number, beat: number, channel = 0): MidiCC {
    return {
        id: `cc-${crypto.randomUUID()}`,
        controller,
        value,
        beat,
        channel,
    };
}

export function createMidiPitchBend(value: number, beat: number, channel = 0): MidiPitchBend {
    return {
        id: `pb-${crypto.randomUUID()}`,
        value,
        beat,
        channel,
    };
}
