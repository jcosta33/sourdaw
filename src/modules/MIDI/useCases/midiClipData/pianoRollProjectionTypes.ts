import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';

export type ClipPlacement = {
    readonly id: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly midiOffsetBeats?: number;
    readonly loopEnabled?: boolean;
    readonly loopLength?: number;
    readonly loopOriginBeat?: number;
};

export type QueryWindow = {
    fromBeat: number;
    toBeat: number;
    maxWork: number;
    maxOutput: number;
    controlChanges?: readonly MidiCC[];
    pitchBends?: readonly MidiPitchBend[];
};

export type BaseGapPianoRollNoteOwner = {
    readonly row: MidiNote;
    readonly displayedStartBeat: number;
    readonly displayedDuration: number;
};

export type BaseOccurrence = {
    row: MidiNote;
    viewId: string;
    startBeat: number;
    duration: number;
    velocity: number;
    occurrenceIndex: number;
};
