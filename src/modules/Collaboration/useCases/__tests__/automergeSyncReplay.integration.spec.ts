import { type Doc, change, load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    getActionReplayStatus,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory as clearCrdtActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { AutomergeSync } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

/** Entries as a peer may send them — including shapes the sanitizer rejects. */
type IncomingHistoryEntry = {
    id: string;
    label: string;
    actionKind?: string;
    source?: string;
    timestamp?: number;
    reverted?: boolean;
};

type RootDocument = {
    actionHistory?: { entries: IncomingHistoryEntry[] };
    /**
     * A document slot with no store projection. Real project slots are
     * back-written by `hydrate()` during projection, which would overwrite the
     * peer's value before the assertion can read it — an orthogonal defect
     * (CC-2). This slot proves the peer's changes reached the repository
     * without entangling these tests with projection behaviour.
     */
    peerProbe?: string;
    projectMeta?: Record<string, unknown>;
};

const no_action_history_metadata_port = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function create_sync(): AutomergeSync {
    return new AutomergeSync({
        getConnectedPeerIds: () => [],
        sendCrdtSync: () => undefined,
    });
}

/** A peer's copy of a live document — same lineage, so merges are meaningful. */
function fork_peer_document(doc_id: string): Doc<RootDocument> {
    const live = getCrdtDoc(doc_id);
    if (!live) {
        throw new Error(`Expected a live ${doc_id} document`);
    }
    return load<RootDocument>(save(live));
}

type DeliverPeerSyncInput = {
    sync: AutomergeSync;
    docId: string;
    remote: Doc<RootDocument>;
};

function deliver_peer_sync({ sync, docId, remote }: DeliverPeerSyncInput): void {
    const live = getCrdtDoc(docId);
    if (!live) {
        throw new Error(`Expected a live ${docId} document`);
    }
    for (const syncMessageBase64 of createPeerSyncMessages({ remote, local: live })) {
        sync.receiveSync({ peerId: 'peer-1', docId, syncMessageBase64 });
    }
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function record_local_action(value: number): Promise<string> {
    await executeAppAction({ type: 'setSnapValue', payload: { value } });
    const entry_id = actionHistoryStore.value?.entries.at(-1)?.id;
    if (!entry_id) {
        throw new Error('Expected local replay metadata');
    }
    // Store writes reach the document on the next frame; a peer copy forked
    // before that flush would not carry the entry at all.
    await flush_pending_frame();
    const persisted = getCrdtDoc<RootDocument>('root')?.actionHistory?.entries.some((entry) => entry.id === entry_id);
    if (persisted !== true) {
        throw new Error('Expected the local action to reach the root document');
    }
    return entry_id;
}

describe('AutomergeSync replay authority integration', () => {
    let unsubscribe_projection: (() => void) | null = null;

    beforeEach(() => {
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        clearHandlerRegistry();
        resetActionReplayAuthority();
        clearUndoHistory();
        registerHandlerMap({
            setSnapValue: {
                undoable: true,
                execute: () => undefined,
                describe: () => ({ label: 'Set snap', inverseAction: { type: 'togglePlayback' } }),
            },
            togglePlayback: {
                undoable: false,
                execute: () => undefined,
                describe: () => ({ label: 'Toggle playback' }),
            },
        });
    });

    afterEach(async () => {
        unsubscribe_projection?.();
        unsubscribe_projection = null;
        clearHandlerRegistry();
        resetActionReplayAuthority();
        clearUndoHistory();
        clearCrdtActionHistory();
        await flush_pending_frame();
        setActionHistoryMetadataPort(no_action_history_metadata_port);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        removeCrdtDoc('branch_feat');
    });

    it("keeps replay authority for an entry a peer's project-truth edit never touched", async () => {
        const entry_id = await record_local_action(0);
        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'ready' });
        unsubscribe_projection = setupProjectionBridge();

        const remote = change(fork_peer_document('root'), (draft) => {
            draft.peerProbe = 'peer edit';
        });
        deliver_peer_sync({ sync: create_sync(), docId: 'root', remote });

        // The peer edit really landed — without this the authority assertion
        // below would pass on an empty sync round.
        expect(getCrdtDoc<RootDocument>('root')?.peerProbe).toBe('peer edit');
        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'ready' });
    });

    it('reports host convergence only after the real root projection installs each authoritative identity', () => {
        const {
            dirty: _dirty,
            loading: _loading,
            identityMigrationPending: _identityMigrationPending,
            initialized: _initialized,
            ...durableProjectMeta
        } = defaultProjectStoreState;
        mutateCrdtDoc<RootDocument>({
            id: 'root',
            changeFn: (draft) => {
                draft.projectMeta = {
                    ...durableProjectMeta,
                    projectId: '11111111-1111-4111-8111-111111111111',
                };
            },
        });
        projectStore.hydrate();
        unsubscribe_projection = setupProjectionBridge();
        const projectedOwnerIds: Array<string | undefined> = [];
        const onSyncConverged = () => projectedOwnerIds.push(projectStore.value?.projectId);

        const sameIdentity = change(fork_peer_document('root'), (draft) => {
            draft.peerProbe = 'host root advanced without changing identity text';
        });
        deliver_peer_sync({
            sync: new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                { onSyncConverged }
            ),
            docId: 'root',
            remote: sameIdentity,
        });

        const intermediate = change(fork_peer_document('root'), (draft) => {
            if (!draft.projectMeta) {
                throw new Error('Expected seeded project metadata');
            }
            draft.projectMeta.projectId = '22222222-2222-4222-8222-222222222222';
        });
        deliver_peer_sync({
            sync: new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                { onSyncConverged }
            ),
            docId: 'root',
            remote: intermediate,
        });

        const authoritative = change(fork_peer_document('root'), (draft) => {
            if (!draft.projectMeta) {
                throw new Error('Expected projected project metadata');
            }
            draft.projectMeta.projectId = '33333333-3333-4333-8333-333333333333';
        });
        deliver_peer_sync({
            sync: new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                { onSyncConverged }
            ),
            docId: 'root',
            remote: authoritative,
        });

        expect(projectedOwnerIds).toEqual([
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333',
        ]);
    });

    it('keeps replay authority when the sync targets a branch document', async () => {
        const entry_id = await record_local_action(0);
        createCrdtDoc('branch_feat');
        unsubscribe_projection = setupProjectionBridge();

        const remote = change(fork_peer_document('branch_feat'), (draft) => {
            draft.peerProbe = 'branch edit';
        });
        deliver_peer_sync({ sync: create_sync(), docId: 'branch_feat', remote });

        expect(getCrdtDoc<RootDocument>('branch_feat')?.peerProbe).toBe('branch edit');
        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'ready' });
    });

    it('keeps replay authority through an empty sync round', async () => {
        const entry_id = await record_local_action(0);
        unsubscribe_projection = setupProjectionBridge();

        // An unmodified peer copy produces the handshake only — no changes.
        deliver_peer_sync({ sync: create_sync(), docId: 'root', remote: fork_peer_document('root') });

        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'ready' });
    });

    it('revokes only the entry a peer sync rewrote and keeps its untouched sibling', async () => {
        const rewritten_entry_id = await record_local_action(0);
        const untouched_entry_id = await record_local_action(1);
        unsubscribe_projection = setupProjectionBridge();

        const remote = change(fork_peer_document('root'), (draft) => {
            const rewritten = draft.actionHistory?.entries.find((entry) => entry.id === rewritten_entry_id);
            if (!rewritten) {
                throw new Error('Expected the peer copy to carry the local history entry');
            }
            rewritten.label = 'Relabelled by a peer';
        });
        deliver_peer_sync({ sync: create_sync(), docId: 'root', remote });

        const projected_labels = actionHistoryStore.value?.entries.map((entry) => entry.label);
        expect(projected_labels).toEqual(['Relabelled by a peer', 'Set snap']);
        expect(getActionReplayStatus(rewritten_entry_id)).toEqual({ status: 'unavailable' });
        expect(getActionReplayStatus(untouched_entry_id)).toEqual({ status: 'ready' });
    });

    it('keeps replay authority when sanitation strips a malformed entry a peer injected', async () => {
        const entry_id = await record_local_action(0);
        unsubscribe_projection = setupProjectionBridge();

        // `reverted` is missing, so `sanitize_action_history_state` rejects the
        // entry and rewrites the slot — which re-lineages the document before
        // the scoping decision sees it.
        const remote = change(fork_peer_document('root'), (draft) => {
            draft.actionHistory?.entries.push({ id: 'peer-junk', label: 'Injected', actionKind: 'noop' });
        });
        deliver_peer_sync({ sync: create_sync(), docId: 'root', remote });

        const projected_ids = actionHistoryStore.value?.entries.map((entry) => entry.id);
        expect(projected_ids).toEqual([entry_id]);
        expect(getActionReplayStatus(entry_id)).toEqual({ status: 'ready' });
    });
});
