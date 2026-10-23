import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore } from '../../../stores/branchStore';
import { setupProjectionBridge } from '../../projection/setupProjectionBridge';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { forkProjectBranch } from '../forkProjectBranch';
import { switchBranch } from '../switchBranch';

// The store projects the active branch's document. A tempo committed locally
// on one branch is not the incoming branch's tempo, so switching must leave the
// store holding what the incoming document holds, including when that
// document's transport slot is byte-identical to the one projected before the
// local edit.

type TransportDocument = { transport?: { tempo?: number } };

const MAIN_TEMPO = 110;
const FEATURE_TEMPO = 97;

vi.mock('../../compactProject', () => ({ compactProject: vi.fn(() => Promise.resolve()) }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
}));

function root_tempo(): number | undefined {
    return automergeRepository.getDoc<TransportDocument>(DOC_PREFIX_ROOT)?.transport?.tempo;
}

function set_tempo(tempo: number): void {
    transportStore.set({ ...defaultTransportState, ...transportStore.value, tempo });
    flushAutomergeStorageWrites();
}

let unsubscribe_projection: (() => void) | null = null;

describe('branch switch projects the incoming branch transport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        automergeRepository.createProject('branch transport projection test');
        registerCrdtStorageRuntime();
        resetAutomergeStorageProjections(DOC_PREFIX_ROOT);
        transportStore.set(defaultTransportState);
        flushAutomergeStorageWrites();
        unsubscribe_projection = setupProjectionBridge();
        branchStore.set({
            branches: [
                {
                    branchId: 'main',
                    name: 'Main',
                    rootDocId: 'root',
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
    });

    afterEach(() => {
        unsubscribe_projection?.();
        unsubscribe_projection = null;
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        automergeRepository.reset();
    });

    it('shows the incoming branch tempo after a tempo edited locally on the outgoing branch', async () => {
        set_tempo(MAIN_TEMPO);
        await forkProjectBranch('feature');
        set_tempo(FEATURE_TEMPO);
        expect(root_tempo()).toBe(FEATURE_TEMPO);

        await switchBranch('main');

        expect(root_tempo()).toBe(MAIN_TEMPO);
        expect(transportStore.value?.tempo).toBe(MAIN_TEMPO);
    });
});
