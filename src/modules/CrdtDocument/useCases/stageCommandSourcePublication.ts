import {
    appendAutomergeStoragePublicationMetadata,
    getCurrentAutomergeStorageMutationOwner,
} from '#/infra/store/storage/createAutomergeStorage';
import { type CommandSourceProof } from '#/utils/handlerContract';

import { automergeRepository } from '../repositories/automergeRepository';

import { captureProjectIdentity } from './captureProjectIdentity';
import { commandSourceDigest } from './commandSourceDigest';
import { commandSourcePublicationContains } from './commandSourcePublicationContains';

/** The caller supplies its actual owned source, never an unvalidated replay payload. */
export function stageCommandSourcePublication(
    kind: string,
    source: unknown,
    reference: CommandSourceProof
): () => void {
    const owner = getCurrentAutomergeStorageMutationOwner();
    if (!owner) {
        return () => undefined;
    }
    const identity = captureProjectIdentity();
    const baseline = automergeRepository.readOwnedDocumentPublications(owner).length;
    const expectedDigest = commandSourceDigest(kind, source);
    const memberId = expectedDigest;
    appendAutomergeStoragePublicationMetadata('root', {
        version: 1,
        memberId,
        kind,
        digest: expectedDigest,
    });
    return () => {
        if (captureProjectIdentity() !== identity) {
            return;
        }
        for (const publication of automergeRepository.readOwnedDocumentPublications(owner).slice(baseline)) {
            if (publication.docId !== 'root') {
                continue;
            }
            for (const hash of publication.heads) {
                if (commandSourcePublicationContains(hash, memberId, kind, expectedDigest)) {
                    reference.changeHash = hash;
                    reference.memberId = memberId;
                    return;
                }
            }
        }
    };
}
