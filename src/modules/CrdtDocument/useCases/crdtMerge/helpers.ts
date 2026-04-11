import { type DocumentBundle } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
export const mergeDocumentBundleFromRepo = (bundle: DocumentBundle) => automergeRepository.mergeBundle(bundle);