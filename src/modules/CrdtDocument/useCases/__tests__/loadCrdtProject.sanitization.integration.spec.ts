import { change, init, load, save, saveIncremental } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../../stores/branchStore';
import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadPersistenceSnapshotFromIdb: vi.fn(),
    saveAllToIdb: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb', () => ({
    loadPersistenceSnapshotFromIdb: mocks.loadPersistenceSnapshotFromIdb,
}));
vi.mock('../../repositories/crdtPersistence/saveAllToIdb', () => ({
    saveAllToIdb: mocks.saveAllToIdb,
}));
vi.mock('#/modules/Command/useCases', () => ({ resetActionReplayAuthority: vi.fn() }));

vi.stubGlobal(
    'Worker',
    vi.fn(() => {
        throw new Error('no worker in test');
    })
);

type PersistedRoot = {
    project: string;
    agentProtocolFuture?: { bytes: number[] };
    actionHistory?: {
        entries: Array<{
            id: string;
            label: string;
            actionKind: string;
            source: 'manual';
            timestamp: number;
            reverted: boolean;
            action?: { type: string };
            inverseAction?: { type: string };
        }>;
    };
};

function authority(revision: number) {
    return { epoch: 'epoch', revision, rootLineage: 'root-lineage' };
}

function create_persisted_bundle({ legacy = false, project = 'B' } = {}): Map<string, Uint8Array> {
    let document = init<PersistedRoot>();
    document = change(document, (draft) => {
        draft.project = project;
        draft.agentProtocolFuture = { bytes: [17, 34, 51] };
        draft.actionHistory = {
            entries: [
                {
                    id: 'entry',
                    label: 'Set tempo',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 1,
                    reverted: false,
                    ...(legacy
                        ? {
                              action: { type: 'setTempo' },
                              inverseAction: { type: 'setTempo' },
                          }
                        : {}),
                },
            ],
        };
    });
    return new Map([['root', save(document)]]);
}

function create_incremental_bundle(): Map<string, Uint8Array> {
    let document = init<PersistedRoot>();
    document = change(document, (draft) => {
        draft.project = 'B';
        draft.actionHistory = { entries: [] };
    });
    const base = save(document);
    document = change(document, (draft) => {
        draft.project = 'C';
    });
    return new Map([
        ['root', base],
        ['root:incremental:1-0', saveIncremental(document)],
    ]);
}

describe('loadCrdtProject persisted action-history sanitization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
        branchStore.set({
            branches: [
                {
                    branchId: MAIN_BRANCH_ID,
                    name: 'Main',
                    rootDocId: 'root',
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: MAIN_BRANCH_ID,
        });
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('should load an already sanitized bundle without advancing persistence authority', async () => {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: authority(4),
            bundle: create_persisted_bundle(),
        });

        await expect(loadCrdtProject()).resolves.toBe(true);

        expect(mocks.saveAllToIdb).not.toHaveBeenCalled();
        expect(automergeRepository.getDoc<PersistedRoot>('root')?.agentProtocolFuture?.bytes).toEqual([17, 34, 51]);
    });

    it('should preserve valid incremental persistence without rewriting it', async () => {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: authority(4),
            bundle: create_incremental_bundle(),
        });

        await expect(loadCrdtProject()).resolves.toBe(true);

        expect(mocks.saveAllToIdb).not.toHaveBeenCalled();
        expect(automergeRepository.getDoc<PersistedRoot>('root')?.project).toBe('C');
    });

    it('should persist a sanitized bundle once when executable legacy fields exist', async () => {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: authority(4),
            bundle: create_persisted_bundle({ legacy: true }),
        });
        mocks.saveAllToIdb.mockResolvedValue({ status: 'committed', authority: authority(5) });

        await expect(loadCrdtProject()).resolves.toBe(true);

        expect(mocks.saveAllToIdb).toHaveBeenCalledTimes(1);
        const persisted_bundle = mocks.saveAllToIdb.mock.calls[0]?.[0] as Map<string, Uint8Array>;
        expect(load<PersistedRoot>(persisted_bundle.get('root')!).agentProtocolFuture?.bytes).toEqual([17, 34, 51]);
        expect(automergeRepository.getDoc<PersistedRoot>('root')?.agentProtocolFuture?.bytes).toEqual([17, 34, 51]);
        expect(automergeRepository.getDoc<PersistedRoot>('root')?.actionHistory?.entries[0]).toEqual({
            id: 'entry',
            label: 'Set tempo',
            actionKind: 'setTempo',
            source: 'manual',
            timestamp: 1,
            reverted: false,
        });
    });

    it('should sanitize the conflicting latest snapshot and retry the compare-and-swap', async () => {
        const first_bundle = create_persisted_bundle({ legacy: true, project: 'B' });
        const latest_bundle = create_persisted_bundle({ legacy: true, project: 'C' });
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: authority(4),
            bundle: first_bundle,
        });
        mocks.saveAllToIdb
            .mockResolvedValueOnce({
                status: 'conflict',
                authority: authority(5),
                bundle: latest_bundle,
            })
            .mockResolvedValueOnce({ status: 'committed', authority: authority(6) });

        await expect(loadCrdtProject()).resolves.toBe(true);

        expect(mocks.saveAllToIdb).toHaveBeenCalledTimes(2);
        expect(mocks.saveAllToIdb.mock.calls[1]?.[1]).toEqual({ expectedAuthority: authority(5) });
        const retried_bundle = mocks.saveAllToIdb.mock.calls[1]?.[0] as Map<string, Uint8Array>;
        expect(load<PersistedRoot>(retried_bundle.get('root')!).agentProtocolFuture?.bytes).toEqual([17, 34, 51]);
        expect(automergeRepository.getDoc<PersistedRoot>('root')?.agentProtocolFuture?.bytes).toEqual([17, 34, 51]);
        expect(automergeRepository.getDoc<PersistedRoot>('root')?.project).toBe('C');
    });
});
