import { getChangesMetaSince, getHeads, getObjectId, hasHeads, inspectChange, type Doc } from '@automerge/automerge';

import { AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY } from '#/infra/store/storage/createAutomergeStorage';
import { isRecord } from '#/utils/structuralEquality';

import { automergeRepository } from '../repositories/automergeRepository';

const causalMembership = new WeakMap<object, Map<string, boolean>>();

function belongsToCurrentFrontier(root: Doc<unknown>, hash: string): boolean {
    const known = causalMembership.get(root) ?? new Map<string, boolean>();
    const cached = known.get(hash);
    if (cached !== undefined) {
        return cached;
    }
    // hasHeads sees the shared backend, including futures and siblings retained
    // by an older view. Query only changes outside this frontier's causal closure.
    // Cache the answer for a known hash, not the whole outside set: the backend
    // can later learn new futures while this immutable view keeps the same heads.
    const belongs = !getChangesMetaSince(root, getHeads(root)).some((change) => change.hash === hash);
    known.set(hash, belongs);
    causalMembership.set(root, known);
    return belongs;
}

export function commandSourcePublicationContains(
    hash: string,
    memberId: string,
    kind: string,
    expectedDigest: string
): boolean {
    const root = automergeRepository.getDoc('root');
    if (!root || !hasHeads(root, [hash])) {
        return false;
    }
    try {
        if (!belongsToCurrentFrontier(root, hash)) {
            return false;
        }
        const change = inspectChange(root, hash);
        if (!change) {
            return false;
        }
        const historical = automergeRepository.getDocAtHeads('root', [hash]);
        const members = historical?.[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY];
        const prior = automergeRepository.getDocAtHeads('root', change.deps)?.[
            AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY
        ];
        // An inherited record does not attest the descendant change. Compare CRDT
        // object identity, since repeating the same real retirement has the same
        // semantic members but creates a fresh record in its own publication.
        if (Array.isArray(members) && Array.isArray(prior) && getObjectId(members) === getObjectId(prior)) {
            return false;
        }
        return (
            Array.isArray(members) &&
            members.some(
                (member) =>
                    isRecord(member) &&
                    member.version === 1 &&
                    member.memberId === memberId &&
                    member.kind === kind &&
                    member.digest === expectedDigest
            )
        );
    } catch {
        return false;
    }
}
