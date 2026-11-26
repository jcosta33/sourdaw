import { type ListItemWritesSince } from '../models/ListItemWritesSince';
import { automergeRepository } from '../repositories/automergeRepository';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

/**
 * What the root document records as written, since `heads` (from `captureRootDocumentHeads`), to the
 * item whose `id` is `itemId` in the list at `listPath`, limited to `keys` and what is nested under
 * them. Whoever wrote it, merged peers included.
 */
export function readRootListItemWritesSince(input: {
    heads: readonly string[];
    listPath: readonly string[];
    itemId: string;
    keys: readonly string[];
}): ListItemWritesSince {
    return automergeRepository.getListItemWritesSince(DOC_PREFIX_ROOT, { ...input, heads: [...input.heads] });
}
