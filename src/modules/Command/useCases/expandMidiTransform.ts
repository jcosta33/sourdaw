import {
    ADD_NOTES_MAX_NOTES_PER_COMMAND,
    MIDI_NOTE_MIN_DURATION_BEATS,
    MIDI_TRANSFORM_MAX_NOTES,
} from '#/utils/midiNoteBatchLimits';

import {
    MIDI_TRANSFORM_BARS_ARGUMENT,
    MIDI_TRANSFORM_BEATS_PER_BAR,
    MIDI_TRANSFORM_CLIP_ARGUMENT,
    type MaterializedMidiNote,
    type MidiTransformAddNotesArguments,
    type MidiTransformParameter,
    type MidiTransformRegistration,
    type MidiTransformRequest,
} from '../models/MidiTransform';
import { getMidiTransform } from '../stores/midiTransformRegistry';

const MAX_TRANSFORM_FAILURE_DETAIL_LENGTH = 200;
/**
 * Provider arguments are an open object, so an undeclared key is attacker-shaped text that would
 * otherwise reach the chat error verbatim. Only an ordinary identifier is worth naming back.
 */
const SAFE_ARGUMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const MAX_ARGUMENT_STRING_LENGTH = 256;
const MAX_MIDI_PITCH = 127;
const MIN_MIDI_VELOCITY = 1;
const MAX_MIDI_VELOCITY = 127;

export type MidiTransformExpansion =
    { commands: readonly MidiTransformAddNotesArguments[] } | { rejectionReason: string };

type ValidatedArguments = Record<string, string | number>;

type Rejection = { status: 'rejected'; reason: string };

type ParameterResult = { status: 'accepted'; value: string | number } | Rejection;
type ArgumentsResult = { status: 'accepted'; value: ValidatedArguments } | Rejection;
type NotesResult = { status: 'accepted'; value: readonly MaterializedMidiNote[] } | Rejection;
type RegistrationResult = { status: 'accepted'; value: MidiTransformRegistration } | Rejection;

function rejected(reason: string): Rejection {
    return { status: 'rejected', reason };
}

function resolveRegisteredTransform(name: string): RegistrationResult {
    const registration = getMidiTransform(name);
    return registration === undefined
        ? rejected(`${name} is not a registered MIDI transform.`)
        : { status: 'accepted', value: registration };
}

function validateParameterValue(name: string, parameter: MidiTransformParameter, value: unknown): ParameterResult {
    if (parameter.type === 'string') {
        if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ARGUMENT_STRING_LENGTH) {
            return rejected(`MIDI transform argument ${name} must be a bounded string.`);
        }
        if (parameter.enum !== undefined && !parameter.enum.includes(value)) {
            return rejected(`MIDI transform argument ${name} is outside its declared values.`);
        }
        return { status: 'accepted', value };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return rejected(`MIDI transform argument ${name} must be a finite number.`);
    }
    if (parameter.type === 'integer' && !Number.isInteger(value)) {
        return rejected(`MIDI transform argument ${name} must be an integer.`);
    }
    if (
        (parameter.minimum !== undefined && value < parameter.minimum) ||
        (parameter.maximum !== undefined && value > parameter.maximum)
    ) {
        return rejected(`MIDI transform argument ${name} is outside its declared bounds.`);
    }
    return { status: 'accepted', value };
}

/**
 * Closed validation against the descriptor: an unknown key is refused rather than forwarded, every
 * bound is the descriptor's own, and an omitted optional argument takes the stated default — so the
 * generator is always called with values the proposal can be reproduced from.
 */
function validateTransformArguments(
    registration: MidiTransformRegistration,
    suppliedArguments: Readonly<Record<string, unknown>>
): ArgumentsResult {
    const { descriptor } = registration;
    const declared = descriptor.parameters.properties;
    for (const key of Object.keys(suppliedArguments)) {
        if (!Object.hasOwn(declared, key)) {
            const named = SAFE_ARGUMENT_NAME_PATTERN.test(key) ? `the argument ${key}` : 'an undeclared argument';
            return rejected(`MIDI transform ${descriptor.name} does not accept ${named}.`);
        }
    }
    const validated: ValidatedArguments = {};
    for (const [name, parameter] of Object.entries(declared)) {
        const supplied = suppliedArguments[name];
        if (supplied === undefined) {
            if (descriptor.parameters.required.includes(name)) {
                return rejected(`MIDI transform ${descriptor.name} requires the argument ${name}.`);
            }
            validated[name] = parameter.default as string | number;
            continue;
        }
        const parameterResult = validateParameterValue(name, parameter, supplied);
        if (parameterResult.status === 'rejected') {
            return parameterResult;
        }
        validated[name] = parameterResult.value;
    }
    return { status: 'accepted', value: validated };
}

function requireTransformFitsClip(input: { bars: number; clipSpanBeats: number; name: string }): Rejection | null {
    const transformSpanBeats = input.bars * MIDI_TRANSFORM_BEATS_PER_BAR;
    return transformSpanBeats <= input.clipSpanBeats
        ? null
        : rejected(
              `MIDI transform ${input.name} spans ${String(transformSpanBeats)} beats but its clip spans ${String(input.clipSpanBeats)} beats.`
          );
}

function runTransformImplementation(
    registration: MidiTransformRegistration,
    transformArguments: ValidatedArguments,
    clipSpanBeats: number
): NotesResult {
    try {
        return { status: 'accepted', value: registration.implementation(transformArguments, { clipSpanBeats }) };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return rejected(
            `MIDI transform ${registration.descriptor.name} could not generate notes: ${detail.slice(0, MAX_TRANSFORM_FAILURE_DETAIL_LENGTH)}`
        );
    }
}

function describeNote(note: MaterializedMidiNote): string {
    return `pitch ${String(note.pitch)} at beat ${String(note.startBeat)}`;
}

function validateNote(input: { clipSpanBeats: number; name: string; note: MaterializedMidiNote }): Rejection | null {
    const { clipSpanBeats, name, note } = input;
    if (![note.pitch, note.startBeat, note.duration, note.velocity].every((value) => Number.isFinite(value))) {
        return rejected(`MIDI transform ${name} produced a note with a non-finite field.`);
    }
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > MAX_MIDI_PITCH) {
        return rejected(`MIDI transform ${name} produced a note outside the MIDI pitch range.`);
    }
    if (!Number.isInteger(note.velocity) || note.velocity < MIN_MIDI_VELOCITY || note.velocity > MAX_MIDI_VELOCITY) {
        return rejected(`MIDI transform ${name} produced a note outside the MIDI velocity range.`);
    }
    if (note.duration < MIDI_NOTE_MIN_DURATION_BEATS) {
        return rejected(
            `MIDI transform ${name} produced a note shorter than ${String(MIDI_NOTE_MIN_DURATION_BEATS)} beats.`
        );
    }
    if (note.startBeat < 0 || note.startBeat + note.duration > clipSpanBeats) {
        return rejected(
            `MIDI transform ${name} produced a note (${describeNote(note)}) outside its ${String(clipSpanBeats)}-beat clip.`
        );
    }
    return null;
}

function validateGeneratedNotes(input: {
    clipSpanBeats: number;
    name: string;
    notes: readonly MaterializedMidiNote[];
}): Rejection | null {
    if (input.notes.length === 0) {
        return rejected(`MIDI transform ${input.name} produced no notes.`);
    }
    if (input.notes.length > MIDI_TRANSFORM_MAX_NOTES) {
        return rejected(
            `MIDI transform ${input.name} produced ${String(input.notes.length)} notes, more than the ${String(MIDI_TRANSFORM_MAX_NOTES)} a transform may write.`
        );
    }
    for (const note of input.notes) {
        const noteRejection = validateNote({ clipSpanBeats: input.clipSpanBeats, name: input.name, note });
        if (noteRejection !== null) {
            return noteRejection;
        }
    }
    return null;
}

/**
 * One `addNotes` carries a bounded number of notes, so a transform wider than that bound occupies
 * several commands. Ordering by start beat keeps the expansion in the order a musician reads it, and
 * keeps two runs of the same seed identical.
 */
function chunkNotesIntoAddNotesCommands(
    clipId: string,
    notes: readonly MaterializedMidiNote[]
): readonly MidiTransformAddNotesArguments[] {
    const ordered = [...notes].sort((left, right) => left.startBeat - right.startBeat);
    const commands: MidiTransformAddNotesArguments[] = [];
    for (let offset = 0; offset < ordered.length; offset += ADD_NOTES_MAX_NOTES_PER_COMMAND) {
        commands.push({ clipId, notes: ordered.slice(offset, offset + ADD_NOTES_MAX_NOTES_PER_COMMAND) });
    }
    return commands;
}

/**
 * Expands one requested transform into the ordinary `addNotes` commands that carry its notes, or
 * says why it will not. Nothing new executes: the project only ever receives `addNotes`, and every
 * bound applied here is one the note owner and the provider schema already read.
 */
export function expandMidiTransform(request: MidiTransformRequest): MidiTransformExpansion {
    const registration = resolveRegisteredTransform(request.name);
    if (registration.status === 'rejected') {
        return { rejectionReason: registration.reason };
    }
    const transformArguments = validateTransformArguments(registration.value, request.arguments);
    if (transformArguments.status === 'rejected') {
        return { rejectionReason: transformArguments.reason };
    }
    const bars = transformArguments.value[MIDI_TRANSFORM_BARS_ARGUMENT] as number;
    const clipId = transformArguments.value[MIDI_TRANSFORM_CLIP_ARGUMENT] as string;
    const spanRejection = requireTransformFitsClip({
        bars,
        clipSpanBeats: request.clipSpanBeats,
        name: registration.value.descriptor.name,
    });
    if (spanRejection !== null) {
        return { rejectionReason: spanRejection.reason };
    }
    const notes = runTransformImplementation(registration.value, transformArguments.value, request.clipSpanBeats);
    if (notes.status === 'rejected') {
        return { rejectionReason: notes.reason };
    }
    const noteRejection = validateGeneratedNotes({
        clipSpanBeats: request.clipSpanBeats,
        name: registration.value.descriptor.name,
        notes: notes.value,
    });
    if (noteRejection !== null) {
        return { rejectionReason: noteRejection.reason };
    }
    return { commands: chunkNotesIntoAddNotesCommands(clipId, notes.value) };
}
