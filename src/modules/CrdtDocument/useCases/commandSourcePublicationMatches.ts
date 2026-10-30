import { isRecord } from '#/utils/structuralEquality';

import { commandSourceDigest } from './commandSourceDigest';
import { commandSourcePublicationContains } from './commandSourcePublicationContains';

export function commandSourcePublicationMatches(kind: string, source: unknown, reference: unknown): boolean {
    return (
        isRecord(reference) &&
        Object.keys(reference).length === 2 &&
        typeof reference.changeHash === 'string' &&
        /^[a-f0-9]{64}$/.test(reference.changeHash) &&
        typeof reference.memberId === 'string' &&
        reference.memberId.length > 0 &&
        commandSourcePublicationContains(
            reference.changeHash,
            reference.memberId,
            kind,
            commandSourceDigest(kind, source)
        )
    );
}
