import { automergeRepository } from '../repositories/automergeRepository';

/** Runtime receipts belong to one execution owner and never enter project or history data. */
export function readOwnedProjectPublications(owner: object) {
    return automergeRepository.readOwnedDocumentPublications(owner);
}
