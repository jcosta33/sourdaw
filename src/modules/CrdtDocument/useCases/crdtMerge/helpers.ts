import { type DocumentBundle } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';

export function mergeDocumentBundleFromRepo(bundle: DocumentBundle) {
    return automergeRepository.mergeBundle(bundle);
}
