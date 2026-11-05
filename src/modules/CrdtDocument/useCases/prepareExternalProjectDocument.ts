import { load } from '@automerge/automerge';

import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { automergeRepository } from '../repositories/automergeRepository';
import { loadPersistenceSnapshotFromIdb } from '../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import { EMPTY_PERSISTENCE_AUTHORITY } from '../repositories/crdtPersistence/persistenceAuthorityModel';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { runCrdtPersistenceLoad } from './runCrdtPersistenceLoad';
import { decodeSdawFile } from './sdawFileFormat/decodeSdawFile';
import { whenBranchStateSettled } from './whenBranchStateSettled';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readProjectRoot(bytes: Uint8Array, projectId: string): Record<string, unknown> {
    const root: unknown = load(bytes);
    if (!isRecord(root) || !isRecord(root.projectMeta) || root.projectMeta.projectId !== projectId) {
        throw new Error('Project directory document identity differs from its manifest');
    }
    return root;
}

/** Decode and verify external project truth before the current document can be replaced. */
export async function prepareExternalProjectDocument(
    bytes: Uint8Array,
    projectId: string
): Promise<{
    commit: (shouldContinue: () => boolean) => Promise<boolean>;
    rootMediaSlots: { tracks: unknown; arrangements: unknown };
}> {
    const bundle = decodeSdawFile(bytes);
    if (!(await automergeRepository.validateAll({ bundle }))) {
        throw new Error('Project directory document is empty');
    }
    const rootBytes = bundle.get(DOC_PREFIX_ROOT);
    if (!rootBytes) {
        throw new Error('Project directory document has no root');
    }
    const root = readProjectRoot(rootBytes, projectId);

    return {
        rootMediaSlots: { tracks: root.tracks ?? null, arrangements: root.arrangements ?? null },
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
                // The directory bundle's root is its saved active project. Branch
                // metadata is stored separately and may still name the outgoing project.
                return {
                    loaded: true,
                    snapshot: { authority: previous?.authority ?? EMPTY_PERSISTENCE_AUTHORITY, bundle },
                };
            }),
    };
}
