import { getChangesMetaSince, getHeads, hasHeads } from '@automerge/automerge';

import { captureProjectIdentity, getCrdtDoc, readOwnedProjectPublications } from '#/modules/CrdtDocument/useCases';

/** The inverse producer owns document authority; Command only settles its staged history. */
export function captureClipReplayPublication(owner: object): () => (() => boolean) | null {
    const baseline = readOwnedProjectPublications(owner).length;
    const identity = captureProjectIdentity();
    return () => {
        const publications = readOwnedProjectPublications(owner).slice(baseline);
        if (publications.length === 0) {
            return null;
        }
        return () =>
            captureProjectIdentity() === identity &&
            publications.every(({ docId, heads }) => {
                const document = getCrdtDoc(docId);
                if (!document || !hasHeads(document, [...heads])) {
                    return false;
                }
                // A historical view shares backend futures and siblings. Only
                // heads in the installed frontier's causal closure attest this write.
                const outside = getChangesMetaSince(document, getHeads(document));
                return heads.every((head) => !outside.some((change) => change.hash === head));
            });
    };
}
