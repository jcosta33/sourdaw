import { automergeRepository } from '../automergeRepository';

import { loadAllFromIdb } from './loadAllFromIdb';

/** Check whether the persisted bundle is present and loadable without committing it. */
export async function hasCrdtDocsInIdb(): Promise<boolean> {
    const bundle = await loadAllFromIdb();
    if (!bundle) {
        return false;
    }

    // Reuse the repository's complete base/incremental decode and exact-root
    // validation without replacing the active in-memory project.
    return automergeRepository.validateAll({ bundle });
}
