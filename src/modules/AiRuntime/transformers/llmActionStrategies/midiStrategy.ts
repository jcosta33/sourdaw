import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { ADD_NOTES_MAX_NOTES_PER_COMMAND, MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import { type ProjectContext, type ProjectContextClip } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { type LlmActionRejection } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';
import { type ClipContentWindow, validateNotesWithinClipWindow } from '../validateNotesWithinClipWindow';

import { findClip, hasExactKeys, isFiniteNumber, rejection } from './bridgeArgumentGuards';
import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export const midiActionNames = [
    'addNotes',
    'quantizeNotes',
    'removeShortMidiOverlaps',
    'arpeggiate',
    'copyMidiArticulations',
    'transposeNotes',
    'retrogradeNotes',
    'invertNotes',
    'quantizeNoteLengths',
    'scaleAllVelocities',
    'setAllVelocities',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type MidiCallName = (typeof midiActionNames)[number];

type MidiStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
};

type MidiStrategy<Name extends MidiCallName> = (
    input: MidiStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type MidiStrategyDefinition<Name extends MidiCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: MidiStrategy<StrategyName>;
    };
}[Name];

type BridgedMidiNote = { pitch: number; startBeat: number; duration: number; velocity?: number };

function findEditableMidiClip(context: ProjectContext, clipId: unknown) {
    const target = findClip(context, clipId);
    if (!target || target.clip.type !== 'midi' || target.clip.locked === true || target.clip.noteCount < 1) {
        return undefined;
    }
    return target;
}

/** A MIDI clip that may receive notes: unlocked, on an unfrozen track, empty or not. */
function findWritableMidiClip(context: ProjectContext, clipId: unknown) {
    const target = findClip(context, clipId);
    if (!target || target.clip.type !== 'midi' || target.clip.locked === true || target.track.frozen === true) {
        return undefined;
    }
    return target;
}

/**
 * The span of clip content that actually sounds, in the clip's own media coordinates. The scheduler
 * reads notes at `note.startBeat - midiOffsetBeats` and drops everything at or past the clip's loop
 * length, so the window starts at the offset and runs for that length — which `projectClipLoopExpansion`
 * reports as the clip's own duration whenever the clip does not loop.
 *
 * The loop length alone is not the bound, because a clip shorter than its own loop never plays a
 * whole iteration: every scheduler truncates one at the clip end, so the content that sounds is
 * whichever of the two is shorter. A four-beat clip looping every sixty-four beats would otherwise
 * accept a note at beat sixty that no route ever reaches.
 */
function clipContentWindow(clip: ProjectContextClip): ClipContentWindow | undefined {
    const startBeat = clip.midiOffsetBeats ?? 0;
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const endBeat = startBeat + Math.min(loopLengthBeats, clip.endBeat - clip.startBeat);
    // A non-finite bound makes every comparison against it false, so an unguarded window would
    // admit any note at all rather than refusing the clip that cannot state where its content is.
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat)) {
        return undefined;
    }
    return { endBeat, startBeat };
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isBridgedMidiNote(value: unknown): value is BridgedMidiNote {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const note: Record<string, unknown> = { ...value };
    const hasVelocity = Object.hasOwn(note, 'velocity');
    const expectedKeys = hasVelocity
        ? ['pitch', 'startBeat', 'duration', 'velocity']
        : ['pitch', 'startBeat', 'duration'];
    return (
        hasExactKeys(note, expectedKeys) &&
        isIntegerInRange(note.pitch, 0, 127) &&
        isFiniteNumber(note.startBeat) &&
        note.startBeat >= 0 &&
        isFiniteNumber(note.duration) &&
        note.duration >= MIDI_NOTE_MIN_DURATION_BEATS &&
        (!hasVelocity || isIntegerInRange(note.velocity, 1, 127))
    );
}

const midiStrategyDefinitions = [
    {
        name: 'addNotes',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findWritableMidiClip(context, args.clipId);
            const notes = args.notes;
            if (
                !hasExactKeys(args, ['clipId', 'notes']) ||
                !target ||
                !Array.isArray(notes) ||
                notes.length === 0 ||
                notes.length > ADD_NOTES_MAX_NOTES_PER_COMMAND ||
                !notes.every(isBridgedMidiNote)
            ) {
                return rejection(
                    index,
                    call.name,
                    `Expected one existing unlocked MIDI clip on an unfrozen track and 1 to ${String(ADD_NOTES_MAX_NOTES_PER_COMMAND)} well-formed notes`
                );
            }
            const window = clipContentWindow(target.clip);
            if (!window) {
                return rejection(
                    index,
                    call.name,
                    `Clip ${target.clip.id} reports a content window that is not a finite range of beats`
                );
            }
            const noteWindowRejection = validateNotesWithinClipWindow(notes, window, 'Note');
            if (noteWindowRejection !== null) {
                return rejection(index, call.name, noteWindowRejection);
            }
            return {
                type: 'addNotes',
                payload: {
                    clipId: target.clip.id,
                    notes: notes.map((note) => ({
                        pitch: note.pitch,
                        startBeat: note.startBeat,
                        duration: note.duration,
                        ...(note.velocity === undefined ? {} : { velocity: note.velocity }),
                    })),
                },
            };
        },
    },
    {
        name: 'quantizeNotes',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'gridSize']) ||
                !target ||
                !isFiniteNumber(args.gridSize) ||
                args.gridSize <= 0 ||
                args.gridSize > 64
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked non-empty MIDI clip and a finite gridSize greater than 0 and at most 64'
                );
            }
            return { type: 'quantizeNotes', payload: { clipId: target.clip.id, gridSize: args.gridSize } };
        },
    },
    {
        name: 'removeShortMidiOverlaps',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'maximumOverlapMs']) ||
                !target ||
                !isFiniteNumber(args.maximumOverlapMs) ||
                args.maximumOverlapMs <= 0 ||
                args.maximumOverlapMs > 1_000
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked non-empty MIDI clip and a finite maximumOverlapMs greater than 0 and at most 1000'
                );
            }
            return {
                type: 'removeShortMidiOverlaps',
                payload: { clipId: target.clip.id, maximumOverlapMs: args.maximumOverlapMs },
            };
        },
    },
    {
        name: 'arpeggiate',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'pattern', 'rate', 'octaves', 'gate']) ||
                !target ||
                args.pattern !== 'up' ||
                args.rate !== 8 ||
                args.octaves !== 1 ||
                args.gate !== 50
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected the exact application-admitted selected MIDI clip and EX-07 arpeggio settings'
                );
            }
            return {
                type: 'arpeggiate',
                payload: { clipId: target.clip.id, pattern: 'up', rate: 8, octaves: 1, gate: 50 },
            };
        },
    },
    {
        name: 'copyMidiArticulations',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findEditableMidiClip(context, args.sourceClipId);
            const target = findEditableMidiClip(context, args.targetClipId);
            if (
                !hasExactKeys(args, ['sourceClipId', 'targetClipId']) ||
                !source ||
                !target ||
                source.clip.id === target.clip.id ||
                source.track.id !== target.track.id
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one exact same-track pair of distinct editable MIDI clips'
                );
            }
            return {
                type: 'copyMidiArticulations',
                payload: { sourceClipId: source.clip.id, targetClipId: target.clip.id },
            };
        },
    },
    {
        name: 'transposeNotes',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'semitones']) ||
                !target ||
                !isFiniteNumber(args.semitones) ||
                !Number.isInteger(args.semitones) ||
                args.semitones < -127 ||
                args.semitones > 127 ||
                args.semitones === 0
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked non-empty MIDI clip and a non-zero integer semitone delta from -127 through 127'
                );
            }
            return { type: 'transposeNotes', payload: { clipId: target.clip.id, semitones: args.semitones } };
        },
    },
    {
        name: 'retrogradeNotes',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (!hasExactKeys(args, ['clipId']) || !target || target.clip.noteCount < 2) {
                return rejection(index, call.name, 'Expected only an unlocked MIDI clip containing at least two notes');
            }
            return { type: 'retrogradeNotes', payload: { clipId: target.clip.id } };
        },
    },
    {
        name: 'invertNotes',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (!hasExactKeys(args, ['clipId']) || !target || target.clip.noteCount < 2) {
                return rejection(index, call.name, 'Expected only an unlocked MIDI clip containing at least two notes');
            }
            return { type: 'invertNotes', payload: { clipId: target.clip.id } };
        },
    },
    {
        name: 'quantizeNoteLengths',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'gridSize']) ||
                !target ||
                !isFiniteNumber(args.gridSize) ||
                args.gridSize < 0.03125 ||
                args.gridSize > 64
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked non-empty MIDI clip and a finite gridSize from 0.03125 through 64'
                );
            }
            return { type: 'quantizeNoteLengths', payload: { clipId: target.clip.id, gridSize: args.gridSize } };
        },
    },
    {
        name: 'scaleAllVelocities',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'factor']) ||
                !target ||
                !isFiniteNumber(args.factor) ||
                args.factor <= 0 ||
                args.factor > 16 ||
                args.factor === 1
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked non-empty MIDI clip and a finite factor greater than 0 and at most 16, excluding 1'
                );
            }
            return { type: 'scaleAllVelocities', payload: { clipId: target.clip.id, factor: args.factor } };
        },
    },
    {
        name: 'setAllVelocities',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableMidiClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'velocity']) ||
                !target ||
                !isFiniteNumber(args.velocity) ||
                !Number.isInteger(args.velocity) ||
                args.velocity < 1 ||
                args.velocity > 127
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked non-empty MIDI clip and an integer velocity from 1 through 127'
                );
            }
            return { type: 'setAllVelocities', payload: { clipId: target.clip.id, velocity: args.velocity } };
        },
    },
] as const satisfies readonly MidiStrategyDefinition<MidiCallName>[];

export const midiStrategyRegistry = createLlmActionStrategyRegistry<
    MidiCallName,
    MidiStrategyInput,
    RuntimeAction | LlmActionRejection
>(midiStrategyDefinitions, midiActionNames);

function isMidiCallName(value: string): value is MidiCallName {
    return midiActionNames.some((actionName) => actionName === value);
}

export function bridgeMidiToolCall(input: MidiStrategyInput): RuntimeAction | LlmActionRejection | null {
    if (!isMidiCallName(input.call.name)) {
        return null;
    }
    const strategy = midiStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
