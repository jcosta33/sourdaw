import type { MidiCC, MidiNote, MidiPitchBend } from '../models/MidiNote';

export type MidiGlobalTimeState = {
    probabilitySeed: number;
    notesByClipId: Record<string, MidiNote[]>;
    ccByClipId: Record<string, MidiCC[]>;
    pitchBendByClipId: Record<string, MidiPitchBend[]>;
    migratedAbsoluteNoteClipIds?: string[];
};

export type MidiGlobalTimeShiftClip = {
    clipId: string;
    eligible: boolean;
    startBeat: number;
    endBeat: number;
    midiOffsetBeats: number;
};

export type MidiGeneratedNoteIdentityRequest = {
    role: 'split-right' | 'duplicate-clone';
    sourceClipId: string;
    sourceNoteId: string;
    sourceNoteIndex: number;
    targetClipId: string;
};

export type MidiGlobalTimeCommand =
    | {
          type: 'shift';
          atBeat: number;
          beatDelta: number;
          clips: readonly MidiGlobalTimeShiftClip[];
      }
    | {
          type: 'split-notes';
          sourceClipId: string;
          targetClipId: string;
          splitBeat: number;
          discardBeforeBeat?: number;
      }
    | {
          type: 'remove-clips';
          clipIds: readonly string[];
      }
    | {
          type: 'copy-notes';
          sourceClipId: string;
          targetClipId: string;
      };

type TransformMidiGlobalTimeStateInput = {
    state: MidiGlobalTimeState;
    commands: readonly MidiGlobalTimeCommand[];
    targetNoteIds?: readonly string[];
};

type TransformMidiGlobalTimeStateResult =
    | {
          status: 'rejected';
          hasChanges: false;
          state: MidiGlobalTimeState;
          identityRequests: readonly MidiGeneratedNoteIdentityRequest[];
      }
    | {
          status: 'ready';
          hasChanges: boolean;
          state: MidiGlobalTimeState;
          identityRequests: readonly MidiGeneratedNoteIdentityRequest[];
      };

type IdentityCursor = {
    requests: MidiGeneratedNoteIdentityRequest[];
    targetNoteIds: readonly string[] | undefined;
    usedNoteIds: Set<string>;
};

type TransformCommandResult =
    | { status: 'rejected'; state: MidiGlobalTimeState }
    | { status: 'ready'; hasChanges: boolean; state: MidiGlobalTimeState };

type TransformEventArrayInput<TRow> = {
    events: TRow[];
    windowStartMedia: number;
    beatDelta: number;
    readBeat: (event: TRow) => number;
    withBeat: (event: TRow, beat: number) => TRow;
};

type TransformedEventArray<TRow> = { status: 'rejected' } | { status: 'ready'; hasChanges: boolean; events: TRow[] };

function transformEventArray<TRow>({
    events,
    windowStartMedia,
    beatDelta,
    readBeat,
    withBeat,
}: TransformEventArrayInput<TRow>): TransformedEventArray<TRow> {
    let hasChanges = false;
    const nextEvents: TRow[] = [];

    for (const event of events) {
        const currentBeat = readBeat(event);
        if (currentBeat < windowStartMedia) {
            nextEvents.push(event);
            continue;
        }

        const shiftedBeat = currentBeat + beatDelta;
        if (!Number.isFinite(shiftedBeat)) {
            return { status: 'rejected' };
        }
        if (shiftedBeat === currentBeat) {
            nextEvents.push(event);
            continue;
        }

        hasChanges = true;
        nextEvents.push(withBeat(event, shiftedBeat));
    }

    if (!hasChanges) {
        return { status: 'ready', hasChanges: false, events };
    }

    return { status: 'ready', hasChanges: true, events: nextEvents };
}

type TransformEventMapInput<TRow> = {
    eventsByClipId: Record<string, TRow[]>;
    clipsById: ReadonlyMap<string, MidiGlobalTimeShiftClip>;
    atBeat: number;
    beatDelta: number;
    readBeat: (event: TRow) => number;
    withBeat: (event: TRow, beat: number) => TRow;
};

type TransformedEventMap<TRow> =
    | { status: 'rejected' }
    | {
          status: 'ready';
          hasChanges: boolean;
          eventsByClipId: Record<string, TRow[]>;
      };

function transformEventMap<TRow>({
    eventsByClipId,
    clipsById,
    atBeat,
    beatDelta,
    readBeat,
    withBeat,
}: TransformEventMapInput<TRow>): TransformedEventMap<TRow> {
    let hasChanges = false;
    let nextEventsByClipId = eventsByClipId;

    for (const [clipId, events] of Object.entries(eventsByClipId)) {
        if (events.length === 0) {
            continue;
        }

        const clip = clipsById.get(clipId);
        if (!clip || !clip.eligible || clip.startBeat >= atBeat || clip.endBeat <= atBeat) {
            continue;
        }

        const windowStartMedia = atBeat - clip.startBeat + clip.midiOffsetBeats;
        if (!Number.isFinite(windowStartMedia)) {
            return { status: 'rejected' };
        }

        const transformedEvents = transformEventArray({
            events,
            windowStartMedia,
            beatDelta,
            readBeat,
            withBeat,
        });
        if (transformedEvents.status === 'rejected') {
            return transformedEvents;
        }
        if (!transformedEvents.hasChanges) {
            continue;
        }

        if (!hasChanges) {
            nextEventsByClipId = { ...eventsByClipId };
        }
        hasChanges = true;
        nextEventsByClipId[clipId] = transformedEvents.events;
    }

    return { status: 'ready', hasChanges, eventsByClipId: nextEventsByClipId };
}

function transformShift(
    state: MidiGlobalTimeState,
    command: Extract<MidiGlobalTimeCommand, { type: 'shift' }>
): TransformCommandResult {
    if (!Number.isFinite(command.atBeat) || !Number.isFinite(command.beatDelta)) {
        return { status: 'rejected', state };
    }
    if (command.beatDelta === 0) {
        return { status: 'ready', hasChanges: false, state };
    }

    const clipsById = new Map(command.clips.map((clip) => [clip.clipId, clip]));
    const notes = transformEventMap({
        eventsByClipId: state.notesByClipId,
        clipsById,
        atBeat: command.atBeat,
        beatDelta: command.beatDelta,
        readBeat: (note) => note.startBeat,
        withBeat: (note, startBeat) => ({ ...note, startBeat }),
    });
    if (notes.status === 'rejected') {
        return { status: 'rejected', state };
    }

    const ccs = transformEventMap({
        eventsByClipId: state.ccByClipId,
        clipsById,
        atBeat: command.atBeat,
        beatDelta: command.beatDelta,
        readBeat: (event) => event.beat,
        withBeat: (event, beat) => ({ ...event, beat }),
    });
    if (ccs.status === 'rejected') {
        return { status: 'rejected', state };
    }

    const pitchBends = transformEventMap({
        eventsByClipId: state.pitchBendByClipId,
        clipsById,
        atBeat: command.atBeat,
        beatDelta: command.beatDelta,
        readBeat: (event) => event.beat,
        withBeat: (event, beat) => ({ ...event, beat }),
    });
    if (pitchBends.status === 'rejected') {
        return { status: 'rejected', state };
    }

    const hasChanges = notes.hasChanges || ccs.hasChanges || pitchBends.hasChanges;
    if (!hasChanges) {
        return { status: 'ready', hasChanges: false, state };
    }

    return {
        status: 'ready',
        hasChanges: true,
        state: {
            ...state,
            notesByClipId: notes.eventsByClipId,
            ccByClipId: ccs.eventsByClipId,
            pitchBendByClipId: pitchBends.eventsByClipId,
        },
    };
}

function takeTargetNoteId(cursor: IdentityCursor, request: MidiGeneratedNoteIdentityRequest): string | null {
    const requestIndex = cursor.requests.length;
    cursor.requests.push(request);

    if (!cursor.targetNoteIds) {
        return `planned-midi-note-${requestIndex}`;
    }

    const targetNoteId = cursor.targetNoteIds[requestIndex];
    if (typeof targetNoteId !== 'string' || targetNoteId.trim().length === 0 || cursor.usedNoteIds.has(targetNoteId)) {
        return null;
    }

    cursor.usedNoteIds.add(targetNoteId);
    return targetNoteId;
}

function createSplitRightHalf(note: MidiNote, duration: number, id: string): MidiNote {
    return {
        id,
        pitch: note.pitch,
        startBeat: 0,
        duration,
        velocity: note.velocity,
        probability: note.probability ?? 100,
        pressure: note.pressure,
        slide: note.slide,
        pitchBend: note.pitchBend,
        // Per-note expression that the field-by-field rebuild used to drop:
        // the MPE channel carries voice routing, and the bend range is what
        // makes a recorded pitchBend mean anything.
        pitchBendRangeSemitones: note.pitchBendRangeSemitones,
        channel: note.channel,
        articulation: note.articulation,
    };
}

function transformSplit(
    state: MidiGlobalTimeState,
    command: Extract<MidiGlobalTimeCommand, { type: 'split-notes' }>,
    cursor: IdentityCursor
): TransformCommandResult {
    if (!Number.isFinite(command.splitBeat)) {
        return { status: 'rejected', state };
    }
    if (command.discardBeforeBeat !== undefined && !Number.isFinite(command.discardBeforeBeat)) {
        return { status: 'rejected', state };
    }

    const sourceNotes = state.notesByClipId[command.sourceClipId];
    if (!sourceNotes || sourceNotes.length === 0) {
        return { status: 'ready', hasChanges: false, state };
    }

    const leftNotes: MidiNote[] = [];
    const rightNotes: MidiNote[] = [];

    for (const [sourceNoteIndex, note] of sourceNotes.entries()) {
        const noteEnd = note.startBeat + note.duration;
        if (!Number.isFinite(noteEnd)) {
            return { status: 'rejected', state };
        }

        if (command.discardBeforeBeat !== undefined) {
            if (noteEnd <= command.discardBeforeBeat) {
                leftNotes.push(note);
                continue;
            }
            if (note.startBeat < command.discardBeforeBeat) {
                const leftDuration = command.discardBeforeBeat - note.startBeat;
                if (!Number.isFinite(leftDuration)) {
                    return { status: 'rejected', state };
                }
                leftNotes.push({ ...note, duration: leftDuration });
                if (noteEnd > command.splitBeat) {
                    const rightDuration = noteEnd - command.splitBeat;
                    if (!Number.isFinite(rightDuration)) {
                        return { status: 'rejected', state };
                    }
                    const request: MidiGeneratedNoteIdentityRequest = {
                        role: 'split-right',
                        sourceClipId: command.sourceClipId,
                        sourceNoteId: note.id,
                        sourceNoteIndex,
                        targetClipId: command.targetClipId,
                    };
                    const targetNoteId = takeTargetNoteId(cursor, request);
                    if (!targetNoteId) {
                        return { status: 'rejected', state };
                    }
                    rightNotes.push(createSplitRightHalf(note, rightDuration, targetNoteId));
                }
                continue;
            }
            if (note.startBeat >= command.splitBeat) {
                const rebasedStartBeat = note.startBeat - command.splitBeat;
                if (!Number.isFinite(rebasedStartBeat)) {
                    return { status: 'rejected', state };
                }
                rightNotes.push({ ...note, startBeat: rebasedStartBeat });
                continue;
            }
            if (noteEnd > command.splitBeat) {
                const rightDuration = noteEnd - command.splitBeat;
                if (!Number.isFinite(rightDuration)) {
                    return { status: 'rejected', state };
                }
                const request: MidiGeneratedNoteIdentityRequest = {
                    role: 'split-right',
                    sourceClipId: command.sourceClipId,
                    sourceNoteId: note.id,
                    sourceNoteIndex,
                    targetClipId: command.targetClipId,
                };
                const targetNoteId = takeTargetNoteId(cursor, request);
                if (!targetNoteId) {
                    return { status: 'rejected', state };
                }
                rightNotes.push(createSplitRightHalf(note, rightDuration, targetNoteId));
            }
            continue;
        }

        if (noteEnd <= command.splitBeat) {
            leftNotes.push(note);
            continue;
        }
        if (note.startBeat >= command.splitBeat) {
            const rebasedStartBeat = note.startBeat - command.splitBeat;
            if (!Number.isFinite(rebasedStartBeat)) {
                return { status: 'rejected', state };
            }
            rightNotes.push({ ...note, startBeat: rebasedStartBeat });
            continue;
        }

        const leftDuration = command.splitBeat - note.startBeat;
        const rightDuration = noteEnd - command.splitBeat;
        if (!Number.isFinite(leftDuration) || !Number.isFinite(rightDuration)) {
            return { status: 'rejected', state };
        }
        leftNotes.push({ ...note, duration: leftDuration });
        const request: MidiGeneratedNoteIdentityRequest = {
            role: 'split-right',
            sourceClipId: command.sourceClipId,
            sourceNoteId: note.id,
            sourceNoteIndex,
            targetClipId: command.targetClipId,
        };
        const targetNoteId = takeTargetNoteId(cursor, request);
        if (!targetNoteId) {
            return { status: 'rejected', state };
        }
        rightNotes.push(createSplitRightHalf(note, rightDuration, targetNoteId));
    }

    const existingRightNotes = state.notesByClipId[command.targetClipId] ?? [];
    return {
        status: 'ready',
        hasChanges: true,
        state: {
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                [command.sourceClipId]: leftNotes,
                [command.targetClipId]: [...existingRightNotes, ...rightNotes],
            },
        },
    };
}

function createDuplicateClone(note: MidiNote, id: string): MidiNote {
    const velocity = readDuplicateVelocity(note);
    const clone: MidiNote = {
        id,
        pitch: Math.round(Math.max(0, Math.min(127, note.pitch))),
        startBeat: note.startBeat,
        duration: Math.max(0.0625, note.duration),
        velocity: Math.round(Math.max(1, Math.min(127, velocity))),
        probability: note.probability ?? 100,
    };

    if (note.pressure !== undefined) {
        clone.pressure = note.pressure;
    }
    if (note.slide !== undefined) {
        clone.slide = note.slide;
    }
    if (note.pitchBend !== undefined) {
        clone.pitchBend = note.pitchBend;
    }
    if (note.pitchBendRangeSemitones !== undefined) {
        clone.pitchBendRangeSemitones = note.pitchBendRangeSemitones;
    }
    if (note.channel !== undefined) {
        clone.channel = note.channel;
    }
    if (note.articulation !== undefined) {
        clone.articulation = note.articulation;
    }

    return clone;
}

function readDuplicateVelocity(note: { velocity?: number }): number {
    return note.velocity ?? 100;
}

function transformCopy(
    state: MidiGlobalTimeState,
    command: Extract<MidiGlobalTimeCommand, { type: 'copy-notes' }>,
    cursor: IdentityCursor
): TransformCommandResult {
    const sourceNotes = state.notesByClipId[command.sourceClipId] ?? [];
    if (sourceNotes.length === 0) {
        return { status: 'ready', hasChanges: false, state };
    }

    const clones: MidiNote[] = [];
    for (const [sourceNoteIndex, note] of sourceNotes.entries()) {
        const request: MidiGeneratedNoteIdentityRequest = {
            role: 'duplicate-clone',
            sourceClipId: command.sourceClipId,
            sourceNoteId: note.id,
            sourceNoteIndex,
            targetClipId: command.targetClipId,
        };
        const targetNoteId = takeTargetNoteId(cursor, request);
        if (!targetNoteId) {
            return { status: 'rejected', state };
        }
        clones.push(createDuplicateClone(note, targetNoteId));
    }

    const existingTargetNotes = state.notesByClipId[command.targetClipId] ?? [];
    return {
        status: 'ready',
        hasChanges: true,
        state: {
            ...state,
            notesByClipId: {
                ...state.notesByClipId,
                [command.targetClipId]: [...existingTargetNotes, ...clones],
            },
        },
    };
}

function transformRemoval(
    state: MidiGlobalTimeState,
    command: Extract<MidiGlobalTimeCommand, { type: 'remove-clips' }>
): TransformCommandResult {
    const clipIds = new Set(command.clipIds);
    let hasMatch = false;
    for (const clipId of clipIds) {
        if (
            Object.hasOwn(state.notesByClipId, clipId) ||
            Object.hasOwn(state.ccByClipId, clipId) ||
            Object.hasOwn(state.pitchBendByClipId, clipId)
        ) {
            hasMatch = true;
            break;
        }
    }
    if (!hasMatch) {
        return { status: 'ready', hasChanges: false, state };
    }

    const notesByClipId = { ...state.notesByClipId };
    const ccByClipId = { ...state.ccByClipId };
    const pitchBendByClipId = { ...state.pitchBendByClipId };
    for (const clipId of clipIds) {
        delete notesByClipId[clipId];
        delete ccByClipId[clipId];
        delete pitchBendByClipId[clipId];
    }

    return {
        status: 'ready',
        hasChanges: true,
        state: { ...state, notesByClipId, ccByClipId, pitchBendByClipId },
    };
}

function collectExistingNoteIds(state: MidiGlobalTimeState): Set<string> {
    const noteIds = new Set<string>();
    for (const notes of Object.values(state.notesByClipId)) {
        for (const note of notes) {
            noteIds.add(note.id);
        }
    }
    return noteIds;
}

export function transformMidiGlobalTimeState({
    state,
    commands,
    targetNoteIds,
}: TransformMidiGlobalTimeStateInput): TransformMidiGlobalTimeStateResult {
    const cursor: IdentityCursor = {
        requests: [],
        targetNoteIds,
        usedNoteIds: collectExistingNoteIds(state),
    };
    let nextState = state;
    let hasChanges = false;

    for (const command of commands) {
        let transformed: TransformCommandResult;
        if (command.type === 'shift') {
            transformed = transformShift(nextState, command);
        } else if (command.type === 'split-notes') {
            transformed = transformSplit(nextState, command, cursor);
        } else if (command.type === 'remove-clips') {
            transformed = transformRemoval(nextState, command);
        } else {
            transformed = transformCopy(nextState, command, cursor);
        }

        if (transformed.status === 'rejected') {
            return {
                status: 'rejected',
                hasChanges: false,
                state,
                identityRequests: cursor.requests,
            };
        }

        hasChanges = hasChanges || transformed.hasChanges;
        nextState = transformed.state;
    }

    if (targetNoteIds && targetNoteIds.length !== cursor.requests.length) {
        return {
            status: 'rejected',
            hasChanges: false,
            state,
            identityRequests: cursor.requests,
        };
    }

    return {
        status: 'ready',
        hasChanges,
        state: nextState,
        identityRequests: cursor.requests,
    };
}
