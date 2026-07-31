import { type HandlerDescribeResult } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNote';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { getMidiClipNotesSnapshot } from '../../useCases/midiNoteTransforms/getMidiClipNotesSnapshot';

type PrepareMidiNoteTransformUndoInput = {
    clipId: string;
    label: string;
    transform: (notes: readonly MidiNote[]) => MidiNote[];
};

type PrepareMidiNoteTransformUndoOutput = {
    description: HandlerDescribeResult;
    isNoop: boolean;
};

export function prepareMidiNoteTransformUndo({
    clipId,
    label,
    transform,
}: PrepareMidiNoteTransformUndoInput): PrepareMidiNoteTransformUndoOutput {
    const notes = getMidiClipNotesSnapshot(clipId);
    if (!notes || notes.length === 0) {
        return { description: { label }, isNoop: true };
    }

    const expectedNotes = transform(notes);
    if (midiNotesEqual(notes, expectedNotes)) {
        return { description: { label }, isNoop: true };
    }

    return {
        description: {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: { clipId, notes, expectedNotes },
            },
        },
        isNoop: false,
    };
}
