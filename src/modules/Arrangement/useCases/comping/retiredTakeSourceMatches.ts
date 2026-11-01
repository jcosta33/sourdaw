import { commandSourcePublicationMatches } from '#/modules/CrdtDocument/useCases';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { sourceOwners, type SourceKind } from './retiredTakeSourceOwners';

export function retiredTakeSourceMatches(
    kind: SourceKind,
    clipIds: readonly string[],
    captures: readonly RetiredTakeLaneSnapshot[],
    reference: unknown,
    undoEntryId: string | undefined
): boolean {
    // Empty producer placeholders and legacy omissions carry no issued proof.
    // Once issued, evidence authenticates the exact capture, even an empty one.
    const proofless =
        reference === undefined ||
        (isRecord(reference) &&
            Object.keys(reference).length === 2 &&
            reference.changeHash === '' &&
            reference.memberId === '');
    return (
        (captures.length === 0 && proofless) ||
        (typeof undoEntryId === 'string' &&
            commandSourcePublicationMatches(kind, sourceOwners(clipIds, captures, undoEntryId), reference))
    );
}
