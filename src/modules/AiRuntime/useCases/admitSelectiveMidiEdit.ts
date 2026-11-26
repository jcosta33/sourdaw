import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type SemanticCommandListItem } from '../models/SemanticCommandList';
import { isMidiNoteEditProposal } from '../transformers/isMidiNoteEditProposal';

import { checkMidiNoteEditAuthority } from './checkMidiNoteEditAuthority';

export function admitSelectiveMidiEdit(input: {
    items: readonly SemanticCommandListItem[];
    callCount: number;
    proof?: Parameters<typeof checkMidiNoteEditAuthority>[0]['proof'];
    authority?: CreativeRequestAuthority;
    revision: string;
}): { status: 'accepted'; clipId?: string } | { status: 'rejected'; reason: string } {
    const editItem = input.items.find((item) => item.name === 'editMidiNotes');
    if (editItem === undefined) {
        return { status: 'accepted' };
    }
    if (
        input.items.length === 1 &&
        input.callCount === 1 &&
        editItem.selector === undefined &&
        editItem.repeat === undefined &&
        isMidiNoteEditProposal(editItem.arguments)
    ) {
        const admission = checkMidiNoteEditAuthority({
            call: editItem,
            proof: input.proof,
            authority: input.authority,
            revision: input.revision,
        });
        if (admission !== null) {
            return { status: 'accepted', clipId: admission.clipId };
        }
    }
    return {
        status: 'rejected',
        reason: 'Selective MIDI editing requires a single clip with positive edit authority and complete current musical evidence.',
    };
}
