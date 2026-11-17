import { type MidiNote } from './MidiNote';

export type MidiNoteEditWindow = { readonly startBeat: number; readonly endBeat: number };

export type MidiNoteEditScope = {
    readonly allowedNoteIds: readonly string[];
    readonly protectedNoteIds: readonly string[];
    readonly protectedWindows: readonly MidiNoteEditWindow[];
    readonly insertionWindows: readonly MidiNoteEditWindow[];
    readonly insertionBudget: number;
};

export type MidiNoteEditPatch = Partial<Pick<MidiNote, 'pitch' | 'startBeat' | 'duration' | 'velocity'>>;

type ExistingMidiNoteEdit =
    { type: 'patch'; noteId: string; patch: MidiNoteEditPatch } | { type: 'delete'; noteId: string };

type MidiNoteInsertion = {
    id?: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity?: number;
};

export type MidiNoteEditOperation = ExistingMidiNoteEdit | { type: 'insert'; note: MidiNoteInsertion };

export type MaterializedMidiNoteInsertion = Omit<MidiNoteInsertion, 'id'> & {
    id: string;
    /** Accepted only as the canonical application default, never as a creative edit. */
    probability?: number;
};

export type MaterializedMidiNoteEditOperation =
    ExistingMidiNoteEdit | { type: 'insert'; note: MaterializedMidiNoteInsertion };
