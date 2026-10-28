import { load } from '@automerge/automerge';

import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import { EMPTY_PERSISTENCE_AUTHORITY } from '../repositories/crdtPersistence/persistenceAuthorityModel';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';
import { restoreActiveBranchSlot } from './loadCrdtProject';
import { runCrdtPersistenceLoad } from './runCrdtPersistenceLoad';
import { decodeSdawFile } from './sdawFileFormat/decodeSdawFile';
import { whenBranchStateSettled } from './whenBranchStateSettled';

/** Decode and verify external project truth before the current document can be replaced. */
export async function prepareExternalProjectDocument(
    bytes: Uint8Array,
    projectId: string
): Promise<{
    commit: (shouldContinue: () => boolean) => Promise<boolean>;
}> {
    const bundle = decodeSdawFile(bytes);
    if (!(await automergeRepository.validateAll({ bundle }))) {
        throw new Error('Project directory document is empty');
    }
    const rootBytes = bundle.get(DOC_PREFIX_ROOT);
    if (!rootBytes) {
        throw new Error('Project directory document has no root');
    }
    const root: unknown = load(rootBytes);
    const metadata = typeof root === 'object' && root !== null && 'projectMeta' in root ? root.projectMeta : null;
    if (
        typeof metadata !== 'object' ||
        metadata === null ||
        !('projectId' in metadata) ||
        metadata.projectId !== projectId
    ) {
        throw new Error('Project directory document identity differs from its manifest');
    }

    return {
        commit: (shouldContinue) =>
            runCrdtPersistenceLoad(async ({ shouldCommit }) => {
                const canCommit = () => shouldCommit() && shouldContinue();
                if (!canCommit()) {
                    return { loaded: false, snapshot: null };
                }
                const previous = await loadPersistenceSnapshotFromIdb();
                if (!canCommit()) {
                    return { loaded: false, snapshot: null };
                }
                const loaded = await automergeRepository.loadAll({ bundle, shouldCommit: canCommit });
                if (!loaded || !canCommit()) {
                    return { loaded: false, snapshot: null };
                }
                resetActionReplayAuthority();
                await whenBranchStateSettled();
                if (!canCommit()) {
                    return { loaded: false, snapshot: null };
                }
                restoreActiveBranchSlot();
                return {
                    loaded: true,
                    snapshot: { authority: previous?.authority ?? EMPTY_PERSISTENCE_AUTHORITY, bundle },
                };
            }),
    };
}
