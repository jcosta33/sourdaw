import { change, init, save, saveIncremental } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';
import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAllFromIdb: vi.fn(),
    replaceAllInIdb: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/loadAllFromIdb', () => ({
    loadAllFromIdb: mocks.loadAllFromIdb,
}));
vi.mock('../../repositories/crdtPersistence/replaceAllInIdb', () => ({
    replaceAllInIdb: mocks.replaceAllInIdb,
}));

vi.stubGlobal(
    'Worker',
    vi.fn(() => {
        throw new Error('no worker in test');
    })
);

type PersistedRootDocument = {
    project: string;
    actionHistory?: {
        entries: Array<{
            id: string;
            label: string;
            actionKind: string;
            source: 'manual';
            timestamp: number;
            reverted: boolean;
            action: { type: string };
            inverseAction: { type: string };
            unknownField: string;
        }>;
    };
};

function create_persisted_bundle(): Map<string, Uint8Array> {
    let document = init<PersistedRootDocument>();
    document = change(document, (draft) => {
        draft.project = 'B';
        draft.actionHistory = {
            entries: [
                {
                    id: 'legacy-entry',
                    label: 'Legacy root action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 1,
                    reverted: false,
                    action: { type: 'setTempo' },
                    inverseAction: { type: 'setTempo' },
                    unknownField: 'drop me',
                },
            ],
        };
    });
    return new Map([['root', save(document)]]);
}

function create_branched_persisted_bundle(): Map<string, Uint8Array> {
    const bundle = create_persisted_bundle();
    let branch_document = init<PersistedRootDocument>();
    branch_document = change(branch_document, (draft) => {
        draft.project = 'B branch';
    });
    bundle.set('branch_feat', save(branch_document));
    branch_document = change(branch_document, (draft) => {
        draft.actionHistory = {
            entries: [
                {
                    id: 'branch-legacy-entry',
                    label: 'Legacy branch action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 2,
                    reverted: false,
                    action: { type: 'setTempo' },
                    inverseAction: { type: 'setTempo' },
                    unknownField: 'drop me',
                },
            ],
        };
    });
    bundle.set('branch_feat:incremental:000001', saveIncremental(branch_document));
    return bundle;
}

describe('loadCrdtProject persisted action-history sanitization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.replaceAllInIdb.mockResolvedValue(undefined);
        automergeRepository.reset();
        automergeRepository.createProject('A');
        automergeRepository.changeDoc<PersistedRootDocument>('root', (document) => {
            document.project = 'A';
        });
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
        automergeRepository.reset();
    });

    it('should expose only a sanitized target document on the first repository notification', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(create_persisted_bundle());
        const observed_documents: Array<{ project: string; actionHistory?: unknown }> = [];
        automergeRepository.onChange(() => {
            const document = automergeRepository.getDoc<PersistedRootDocument>('root');
            if (document) {
                observed_documents.push({ project: document.project, actionHistory: document.actionHistory });
            }
        });

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('loaded');
        expect(mocks.replaceAllInIdb).toHaveBeenCalledTimes(1);
        expect(observed_documents).toEqual([
            {
                project: 'B',
                actionHistory: {
                    entries: [
                        {
                            id: 'legacy-entry',
                            label: 'Legacy root action',
                            actionKind: 'setTempo',
                            source: 'manual',
                            timestamp: 1,
                            reverted: false,
                        },
                    ],
                },
            },
        ]);
    });

    it('should leave the active repository and listeners untouched when sanitization fails', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map([['root', new Uint8Array([1, 2, 3])]]));
        const listener = vi.fn();
        automergeRepository.onChange(listener);

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('sanitization-failed');
        expect(mocks.replaceAllInIdb).not.toHaveBeenCalled();
        expect(automergeRepository.getDoc<PersistedRootDocument>('root')?.project).toBe('A');
        expect(listener).not.toHaveBeenCalled();
    });

    it('should sanitize every branch incremental chain before restoring the active branch into root', async () => {
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
                {
                    branchId: 'feat',
                    name: 'Feature',
                    rootDocId: 'branch_feat',
                    sourceBranchId: 'main',
                    createdAt: 2,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'feat',
        });
        mocks.loadAllFromIdb.mockResolvedValue(create_branched_persisted_bundle());
        const observed_action_history: Array<{ root?: unknown; branch?: unknown }> = [];
        automergeRepository.onChange(() => {
            observed_action_history.push({
                root: automergeRepository.getDoc<PersistedRootDocument>('root')?.actionHistory,
                branch: automergeRepository.getDoc<PersistedRootDocument>('branch_feat')?.actionHistory,
            });
        });

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('loaded');
        expect(mocks.replaceAllInIdb).toHaveBeenCalledTimes(1);
        const root_metadata = {
            entries: [
                {
                    id: 'legacy-entry',
                    label: 'Legacy root action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 1,
                    reverted: false,
                },
            ],
        };
        const branch_metadata = {
            entries: [
                {
                    id: 'branch-legacy-entry',
                    label: 'Legacy branch action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 2,
                    reverted: false,
                },
            ],
        };
        expect(observed_action_history).toEqual([
            { root: root_metadata, branch: branch_metadata },
            { root: branch_metadata, branch: branch_metadata },
        ]);
        expect(automergeRepository.getDoc<PersistedRootDocument>('root')?.project).toBe('B branch');
    });
});
