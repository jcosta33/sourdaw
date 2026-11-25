import { type Clip } from '#/modules/Arrangement/stores';
import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerSessionActionEntry, type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { planGuardedMidiNoteEdits } from '../../services/planGuardedMidiNoteEdits';
import { midiStore } from '../../stores/midiStore';
import { findEditableBaseMidiClip } from '../../useCases/midiNoteCrud/findEditableBaseMidiClip';
import { projectMidiNoteEditPrefix } from '../../useCases/midiNoteTransforms/projectMidiNoteEditPrefix';

type EditAction = Extract<AppAction, { type: 'editMidiNotes' }>;
type EditPlan = NonNullable<ReturnType<typeof planGuardedMidiNoteEdits>>;

function makeReplay(plan: EditPlan, direction: 'undo' | 'redo'): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    const afterPresent = plan.beforePresent || !plan.isNoop;
    return {
        type: 'restoreMidiClipNotes',
        payload: {
            clipId: plan.clipId,
            notes: direction === 'undo' ? plan.before : plan.notes,
            expectedNotes: direction === 'undo' ? plan.notes : plan.before,
            notesBucketPresent: direction === 'undo' ? plan.beforePresent : afterPresent,
            expectedNotesBucketPresent: direction === 'undo' ? afterPresent : plan.beforePresent,
            noteTransformReplayGuard: {
                trackId: plan.trackId,
                expectedTrackFrozen: false,
                expectedClipLocked: false,
                requiresEditableBaseClip: true,
            },
        },
    };
}

function describePlan(plan: EditPlan): string {
    const beforeById = new Map(plan.before.map((note) => [note.id, note]));
    const afterById = new Map(plan.notes.map((note) => [note.id, note]));
    const patched = plan.before.filter((note) => afterById.has(note.id) && !valuesEqual(note, afterById.get(note.id)));
    const removed = plan.before.filter((note) => !afterById.has(note.id));
    const inserted = plan.notes.filter((note) => !beforeById.has(note.id));
    return `Edit MIDI notes (${patched.length} updated, ${removed.length} removed, ${inserted.length} inserted)`;
}

function editFitsClip(plan: EditPlan, clip: Clip): boolean {
    const loopEnabled = clip.loopEnabled === true;
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });
    const regionStartBeat =
        (clip.midiOffsetBeats ?? 0) -
        resolveClipLoopOriginAdvance({
            startBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
            loopEnabled,
        });
    return (
        expansion.iterationCount > 0 &&
        plan.editWindow.startBeat >= regionStartBeat &&
        plan.editWindow.endBeat <= regionStartBeat + expansion.loopLengthBeats
    );
}

function planAgainstProject(action: EditAction, context?: HandlerValidationContext): EditPlan | null {
    const { clipId, guard } = action.payload;
    const trackId = guard?.trackId;
    if (typeof trackId !== 'string') {
        return null;
    }
    const clip = findEditableBaseMidiClip(clipId, trackId);
    if (!clip) {
        return null;
    }
    const bucket = projectMidiNoteEditPrefix(clipId, trackId, context);
    const plan = bucket && planGuardedMidiNoteEdits(action.payload, bucket);
    return plan && editFitsClip(plan, clip) ? plan : null;
}

function isEditMidiNotesSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'editMidiNotes') {
        return false;
    }
    const plan = planGuardedMidiNoteEdits(entry.action.payload);
    return (
        plan !== null &&
        !plan.isNoop &&
        valuesEqual(entry.inverseAction, makeReplay(plan, 'undo')) &&
        valuesEqual(entry.redoAction, makeReplay(plan, 'redo'))
    );
}

export const handleEditMidiNotes = createHandler<'editMidiNotes'>({
    validateMaterializedCommandArguments: (value) => planGuardedMidiNoteEdits(value) !== null,
    validateSessionEntry: isEditMidiNotesSessionEntry,
    validate: (action, context) => planAgainstProject(action, context) !== null,
    validationRefusalReason: () => 'The MIDI edit disagrees with its allowed clip, note snapshot or batch prefix',
    describe: (action) => {
        const plan = planGuardedMidiNoteEdits(action.payload);
        if (!plan) {
            return { label: 'Edit MIDI notes' };
        }
        return {
            label: describePlan(plan),
            inverseAction: makeReplay(plan, 'undo'),
            redoAction: makeReplay(plan, 'redo'),
        };
    },
    execute: (action) => {
        const plan = planAgainstProject(action);
        const state = midiStore.value;
        if (!plan || !state) {
            return { status: 'conflict' };
        }
        if (plan.isNoop) {
            return { status: 'no-write' };
        }
        // Keep the live, untouched rows. The same identity-aware storage write inserts and deletes
        // only the planned members and reconciles fields on patched notes in place.
        const changedIds = new Set(plan.changes.map((change) => change.noteId));
        const untouched = new Map(
            (state.notesByClipId[plan.clipId] ?? [])
                .filter((note) => !changedIds.has(note.id))
                .map((note) => [note.id, note])
        );
        const notes = plan.notes.map((note) => untouched.get(note.id) ?? note);
        midiStore.set({ ...state, notesByClipId: { ...state.notesByClipId, [plan.clipId]: notes } });
        return { status: 'written' };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
