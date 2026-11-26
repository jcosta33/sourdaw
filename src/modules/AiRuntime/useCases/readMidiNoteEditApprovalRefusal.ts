import { readPianoRollSelection } from '#/modules/MIDI/useCases';
import { isRecord } from '#/utils/structuralEquality';

import { approvedProjectRevision } from './approvedProjectRevision';

export function readMidiNoteEditApprovalRefusal(
    actions: readonly { type: string; payload?: unknown }[],
    revision?: string
): string | null {
    const edits = actions.filter((action) => action.type === 'editMidiNotes');
    if (edits.length === 0) {
        return null;
    }
    if (revision !== undefined && !approvedProjectRevision.matchesLive(revision)) {
        return 'The MIDI edit’s project revision changed; start a fresh request.';
    }
    const selection = readPianoRollSelection();
    const payload = edits[0]?.payload;
    return edits.length === 1 &&
        isRecord(payload) &&
        isRecord(payload.guard) &&
        payload.guard.selectionToken === selection.token &&
        payload.clipId === selection.clipId &&
        selection.status === 'resolved'
        ? null
        : 'The MIDI note selection changed; start a fresh request.';
}
