import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { isGrooveTemplate, STRAIGHT_GROOVE_TEMPLATE_ID } from '../../models/GrooveTemplate';

/**
 * Only an extraction carrying the template it will create, extracted from the named MIDI clip, and
 * the note revision it was read at is a deterministic command: execution creates exactly that
 * template or refuses because the clip's notes changed. An extraction that found no groove carries
 * no proposal, so it never compiles.
 */
export function isMaterializedExtractGroovePayload(value: unknown): boolean {
    if (!isRecord(value) || typeof value.clipId !== 'string' || value.clipId.length === 0) {
        return false;
    }
    const { proposal } = value;
    return (
        typeof value.sourceRevision === 'string' &&
        value.sourceRevision.length > 0 &&
        (value.sourceName === undefined || typeof value.sourceName === 'string') &&
        (value.subdivision === undefined || typeof value.subdivision === 'string') &&
        (value.templateId === undefined || (isRecord(proposal) && proposal.id === value.templateId)) &&
        isGrooveTemplate(proposal) &&
        proposal.id !== STRAIGHT_GROOVE_TEMPLATE_ID &&
        proposal.provenance.type === 'midi-clip' &&
        proposal.provenance.sourceId === value.clipId
    );
}

/**
 * A saved extraction is replayable only when its undo deletes exactly the template it created and
 * only while that template is unchanged and unassigned, and its redo re-runs the pinned extraction.
 */
export function isExtractGrooveSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (action.type !== 'extractGroove' || !isMaterializedExtractGroovePayload(action.payload)) {
        return false;
    }
    return (
        redoAction === undefined &&
        inverseAction?.type === 'deleteGrooveTemplate' &&
        inverseAction.payload.templateId === action.payload.proposal?.id &&
        valuesEqual(inverseAction.payload.expectedTemplate, action.payload.proposal)
    );
}
