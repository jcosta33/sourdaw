import { type HandlerDescribeResult, type HandlerValidationContext } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNote';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { getMidiClipNotesSnapshot } from '../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot';
import { projectMidiNotesByClipIdThroughRestores } from '../../useCases/midiNoteTransforms/projectMidiNotesByClipIdThroughRestores';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

type PrepareMidiNoteTransformUndoInput = {
    clipId: string;
    label: string;
    transform: (notes: readonly MidiNote[]) => MidiNote[];
    /** When given, the notes are read as the batch's earlier actions leave them, not as the store holds them. */
    context?: HandlerValidationContext;
};

type PrepareMidiNoteTransformUndoOutput = {
    description: HandlerDescribeResult;
    isNoop: boolean;
};

function readProjectedNotes(clipId: string, context: HandlerValidationContext): MidiNote[] | null {
    const projected = projectMidiNotesByClipIdThroughRestores(context.actions.slice(0, context.actionIndex));
    return projected[clipId] ?? null;
}

export function prepareMidiNoteTransformUndo({
    clipId,
    label,
    transform,
    context,
}: PrepareMidiNoteTransformUndoInput): PrepareMidiNoteTransformUndoOutput {
    const notes = context ? readProjectedNotes(clipId, context) : getMidiClipNotesSnapshot(clipId);
    if (!notes || notes.length === 0) {
        return { description: { label }, isNoop: true };
    }

    const expectedNotes = transform(notes);
    if (midiNotesEqual(notes, expectedNotes)) {
        return { description: { label }, isNoop: true };
    }
    const noteTransformReplayGuard = getWritableMidiClipReplayGuardForBatch(clipId, context);
    if (!noteTransformReplayGuard) {
        return { description: { label }, isNoop: false };
    }

    return {
        description: {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: { clipId, notes, expectedNotes, noteTransformReplayGuard },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: { clipId, notes: expectedNotes, expectedNotes: notes, noteTransformReplayGuard },
            },
        },
        isNoop: false,
    };
}
