import {
    init as automergeInit,
    initSyncState,
    change,
    clone,
    generateSyncMessage,
    type Doc,
} from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    replaceCrdtDoc,
    sanitizeIncomingCrdtDocument,
    hasCrdtDoc,
    getCrdtDocIds,
} from '#/modules/CrdtDocument/useCases';
import { bytesToBase64 } from '#/utils/base64';

import { AutomergeSync } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

const command_mocks = vi.hoisted(() => ({
    sync_action_replay_metadata: vi.fn<(entries: readonly { id: string }[]) => void>(),
}));

const crdt_mocks = vi.hoisted(() => ({
    wait_for_document_transition: vi.fn<(docId: string) => Promise<void> | null>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    syncActionReplayMetadata: command_mocks.sync_action_replay_metadata,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    subscribeToCrdtChanges: vi.fn(),
    getCrdtDoc: vi.fn(),
    createCrdtDoc: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn().mockReturnValue([]),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
    waitForCrdtDocumentTransition: crdt_mocks.wait_for_document_transition,
    sanitizeIncomingCrdtDocument: vi.fn((document) => document),
    DOC_PREFIX_ROOT: 'root',
    DOC_BRANCHES: '__branches__',
}));

function makePeerManager() {
    return {
        getConnectedPeerIds: vi.fn().mockReturnValue([]),
        sendCrdtSync: vi.fn(),
    };
}

/** A real base64 Automerge sync message for the `root` doc (so receiveSync's
 *  receiveSyncMessage decode succeeds and we reach replaceCrdtDoc). */
function makeRealSyncMessage(): string {
    const doc = createAmDoc();
    const [, message] = generateSyncMessage(doc, initSyncState());
    return bytesToBase64(message!);
}

// Minimal real Automerge doc helper. `@automerge/automerge` is NOT mocked, so
// this returns a genuine empty doc for receiveSyncMessage to operate on.
function createAmDoc(): Doc<unknown> {
    return automergeInit();
}

type SeededDoc = {
    actionHistory?: { entries: { id: string }[] };
    /** A slot with no store projection — stands in for ordinary project truth. */
    peerProbe?: string;
};

/**
 * A document seeded with the shared history slot, so a peer copy forked from it
 * merges against the same lineage instead of an unrelated document.
 */
function seedAmDoc(): Doc<SeededDoc> {
    return change(automergeInit<SeededDoc>('aaaaaaaaaaaaaaaa'), (draft) => {
        draft.actionHistory = { entries: [] };
    });
}

/**
 * Forks `deliverPeerSync`'s "live" and "remote" documents from one canonical
 * `seedAmDoc()` call instead of calling it twice.
 *
 * `change()` stamps every change with the wall-clock second, so two
 * independent `seedAmDoc()` calls only produce byte-identical seq-1 changes
 * when they land in the same second — under load they can straddle a
 * boundary, and Automerge then rejects the second seq 1 from actor
 * `aaaaaaaaaaaaaaaa` as ambiguous (`RangeError: duplicate seq 1 found for
 * actor aaaaaaaaaaaaaaaa`). Cloning a single genesis document is
 * deterministic regardless of timing, and giving each fork its own actor id
 * keeps them from ever colliding on a future seq of their own.
 */
function forkPeerDocs(): { live: Doc<SeededDoc>; remoteSeed: Doc<SeededDoc> } {
    const canonical = seedAmDoc();
    return {
        live: clone<SeededDoc>(canonical, 'aaaaaaaaaaaaaaaa'),
        remoteSeed: clone<SeededDoc>(canonical, 'bbbbbbbbbbbbbbbb'),
    };
}

describe('AutomergeSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crdt_mocks.wait_for_document_transition.mockReturnValue(null);
    });

    it('subscribes to CRDT changes on start using injected dependencies', () => {
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(() => {});
        const sync = new AutomergeSync(makePeerManager());

        sync.start();

        expect(subscribeToCrdtChanges).toHaveBeenCalledTimes(1);
    });

    it('§fix-14 start() is idempotent: a second start unsubscribes the first', () => {
        const unsub = vi.fn();
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(unsub);
        const sync = new AutomergeSync(makePeerManager());

        sync.start();
        sync.start();

        // The first subscription must be torn down before re-subscribing.
        expect(unsub).toHaveBeenCalledTimes(1);
        expect(subscribeToCrdtChanges).toHaveBeenCalledTimes(2);
    });

    it('§fix-5 drops a sync for an unknown docId (never mints arbitrary docs)', () => {
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'p1', docId: 'evil-doc', syncMessageBase64: makeRealSyncMessage() });

        expect(createCrdtDoc).not.toHaveBeenCalled();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('§fix-5 accepts a sync for a known docId (root)', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'p1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(replaceCrdtDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
    });

    it('defers an incoming branch-document sync until its owning transition releases the document', async () => {
        let releaseTransition: (() => void) | undefined;
        const transition = new Promise<void>((resolve) => {
            releaseTransition = resolve;
        });
        crdt_mocks.wait_for_document_transition.mockReturnValueOnce(transition).mockReturnValue(null);
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({
            peerId: 'peer-1',
            docId: 'branch_candidate',
            syncMessageBase64: makeRealSyncMessage(),
        });

        expect(replaceCrdtDoc).not.toHaveBeenCalled();
        releaseTransition?.();
        await transition;
        await Promise.resolve();

        expect(replaceCrdtDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'branch_candidate' }));
    });

    it.each(['root', 'branch_feature'])('sanitizes and persists an authorized peer document: %s', async (doc_id) => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        const sanitized_document = createAmDoc();
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(sanitizeIncomingCrdtDocument).mockReturnValueOnce(sanitized_document);
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: doc_id, syncMessageBase64: makeRealSyncMessage() });

        expect(sanitizeIncomingCrdtDocument).toHaveBeenCalledTimes(1);
        expect(replaceCrdtDoc).toHaveBeenCalledWith({ id: doc_id, doc: sanitized_document });
        expect(persistCrdtProject).toHaveBeenCalledTimes(1);
    });

    /**
     * CC-3 — replay-authority invalidation is scoped to what the sync touched.
     *
     * Installs a mutable stand-in repository so a multi-round Automerge
     * handshake (the first message carries no changes) reaches `receiveSync`
     * exactly as it would in a session.
     */
    function deliverPeerSync({ docId, mutate }: { docId: string; mutate?: (draft: SeededDoc) => void }): string[] {
        const order: string[] = [];
        const { live: initial_live, remoteSeed } = forkPeerDocs();
        let live = initial_live;
        vi.mocked(getCrdtDoc).mockImplementation(() => live);
        vi.mocked(replaceCrdtDoc).mockImplementation(({ doc }) => {
            order.push('replace-document');
            live = doc;
        });
        command_mocks.sync_action_replay_metadata.mockImplementation(() => {
            order.push('reconcile-replay-metadata');
        });

        const remote = mutate ? change(remoteSeed, mutate) : remoteSeed;
        const sync = new AutomergeSync(makePeerManager());
        for (const syncMessageBase64 of createPeerSyncMessages({ remote, local: live })) {
            sync.receiveSync({ peerId: 'editor', docId, syncMessageBase64 });
        }
        return order;
    }

    it('leaves replay authority alone when a root sync applies no change', () => {
        const order = deliverPeerSync({ docId: 'root' });

        expect(order).toEqual(['replace-document']);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
    });

    /**
     * Regression guard for the actor-seq collision: `seedAmDoc()` stamps its
     * change with `Math.floor(Date.now() / 1000)`, so two independent calls
     * used to only agree when they landed in the same wall-clock second. This
     * forces a straddle across that second boundary to prove `forkPeerDocs`
     * no longer depends on timing — before the fix this threw
     * `RangeError: duplicate seq 1 found for actor aaaaaaaaaaaaaaaa`.
     */
    it('stays deterministic when the underlying seed change would straddle a wall-clock second', () => {
        const now_spy = vi.spyOn(Date, 'now');
        now_spy.mockReturnValueOnce(1_700_000_000_000);
        now_spy.mockReturnValueOnce(1_700_000_001_000);
        try {
            const order = deliverPeerSync({ docId: 'root' });
            expect(order).toEqual(['replace-document']);
            expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
        } finally {
            now_spy.mockRestore();
        }
    });

    it("leaves replay authority alone when a root sync only touches a slot that isn't the action history", () => {
        const order = deliverPeerSync({
            docId: 'root',
            mutate: (draft) => {
                draft.peerProbe = 'peer edit';
            },
        });

        expect(order).toEqual(['replace-document', 'replace-document']);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
    });

    it('leaves replay authority alone when the action history changes on a branch document', () => {
        const order = deliverPeerSync({
            docId: 'branch_feature',
            mutate: (draft) => {
                draft.actionHistory = { entries: [{ id: 'branch-entry' }] };
            },
        });

        expect(order).toEqual(['replace-document', 'replace-document']);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
    });

    it('reconciles replay authority after installing a root sync that rewrote the action history', () => {
        const order = deliverPeerSync({
            docId: 'root',
            mutate: (draft) => {
                draft.actionHistory = { entries: [{ id: 'peer-entry' }] };
            },
        });

        // Reconciliation must run against the *projected* post-sync history, so
        // it can only happen after the document is installed.
        expect(order).toEqual(['replace-document', 'replace-document', 'reconcile-replay-metadata']);
        expect(command_mocks.sync_action_replay_metadata).toHaveBeenCalledTimes(1);
    });

    it('should abort install and persistence when CrdtDocument sanitation fails', async () => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementationOnce(() => {
            throw new Error('sanitation failed');
        });
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
        expect(persistCrdtProject).not.toHaveBeenCalled();
    });

    it('drops a sync the canApplySync hook rejects', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const canApplySync = vi.fn().mockReturnValue(false);
        const sync = new AutomergeSync(makePeerManager(), { canApplySync });

        sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(canApplySync).toHaveBeenCalledWith('peer-1', 'root');
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('applies a sync the canApplySync hook accepts', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const canApplySync = vi.fn().mockReturnValue(true);
        const sync = new AutomergeSync(makePeerManager(), { canApplySync });

        sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(replaceCrdtDoc).toHaveBeenCalled();
    });

    it('§fix-4 does not re-broadcast the repository change triggered while applying a remote sync', () => {
        // Capture the change callback registered on start().
        let changeCb: ((docId?: string) => void) | undefined;
        vi.mocked(subscribeToCrdtChanges).mockImplementation((cb) => {
            changeCb = cb;
            return () => {};
        });
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        // replaceCrdtDoc re-enters the change subscription synchronously, the
        // way the real repository does on a doc replace.
        vi.mocked(replaceCrdtDoc).mockImplementation(() => {
            changeCb?.('root');
        });

        const peerManager = { getConnectedPeerIds: vi.fn().mockReturnValue(['p2']), sendCrdtSync: vi.fn() };
        const sync = new AutomergeSync(peerManager);
        sync.start();

        sync.receiveSync({ peerId: 'p1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        // The guard must suppress the echo: no sync generated back to peers
        // during the apply.
        expect(peerManager.sendCrdtSync).not.toHaveBeenCalled();
    });

    it('§fix-6 surfaces a persist failure via onPersistError', async () => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        vi.mocked(persistCrdtProject).mockRejectedValueOnce(new Error('idb full'));
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const onPersistError = vi.fn();
        const sync = new AutomergeSync(makePeerManager(), { onPersistError });

        sync.receiveSync({ peerId: 'p1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });
        // Let the rejected persist promise settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(onPersistError).toHaveBeenCalled();
    });

    it('stop() unsubscribes from changes and clears sync state', () => {
        const unsub = vi.fn();
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(unsub);
        const sync = new AutomergeSync(makePeerManager());
        sync.start();

        sync.stop();

        expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('stop() is safe to call before start()', () => {
        const sync = new AutomergeSync(makePeerManager());
        expect(() => sync.stop()).not.toThrow();
    });

    it('creates a known-but-absent doc before applying the received sync', () => {
        const doc = createAmDoc();
        vi.mocked(getCrdtDoc).mockReturnValueOnce(undefined).mockReturnValue(doc);
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(createCrdtDoc).toHaveBeenCalledWith('root');
        expect(replaceCrdtDoc).toHaveBeenCalledWith({ id: 'root', doc });
    });

    it('drops a malformed sync message from a peer without throwing', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());
        const garbage = bytesToBase64(new Uint8Array([1, 2, 3]));

        expect(() => sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: garbage })).not.toThrow();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('handlePeerMessage forwards a crdt-sync message to receiveSync', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());

        sync.handlePeerMessage({
            peerId: 'editor',
            message: { type: 'crdt-sync', docId: 'root', data: makeRealSyncMessage() },
        });

        expect(replaceCrdtDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
    });

    it('handlePeerMessage ignores non crdt-sync message types', () => {
        const sync = new AutomergeSync(makePeerManager());

        expect(() =>
            sync.handlePeerMessage({ peerId: 'p2', message: { type: 'peer-leave', peerId: 'p2' } })
        ).not.toThrow();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('addPeer sends the initial sync for the root doc to the new peer', async () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        // Sends are ordered against actual delivery, so they settle on the
        // microtask queue rather than inside addPeer.
        await vi.waitFor(() => {
            expect(peerManager.sendCrdtSync).toHaveBeenCalledWith({
                peerId: 'p1',
                message: { type: 'crdt-sync', docId: 'root', data: expect.any(String) },
            });
        });
    });

    it('addPeer also syncs the branch metadata doc when it exists', async () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(hasCrdtDoc).mockReturnValue(true);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        await vi.waitFor(() => {
            const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
                const [{ message }] = call as [{ message: { docId: string } }];
                return message.docId;
            });
            expect(syncedDocIds).toContain('__branches__');
        });
    });

    it('addPeer syncs branch content docs, skipping ids that are not branch-prefixed', async () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(getCrdtDocIds).mockReturnValue(['branch_a', 'other_doc']);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        await vi.waitFor(() => {
            const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
                const [{ message }] = call as [{ message: { docId: string } }];
                return message.docId;
            });
            expect(syncedDocIds).toContain('branch_a');
        });
        const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
            const [{ message }] = call as [{ message: { docId: string } }];
            return message.docId;
        });
        expect(syncedDocIds).not.toContain('other_doc');
    });

    it('addPeer is a no-op for a doc that does not exist locally yet', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(undefined);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        expect(peerManager.sendCrdtSync).not.toHaveBeenCalled();
    });

    it('removePeer clears state for a peer without throwing, including for an unknown peer', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());
        sync.addPeer('p1');

        expect(() => sync.removePeer('p1')).not.toThrow();
        expect(() => sync.removePeer('ghost')).not.toThrow();
    });

    it('a bulk change with no docId hint syncs every connected peer via the full sweep', async () => {
        let changeCb: ((docId?: string) => void) | undefined;
        vi.mocked(subscribeToCrdtChanges).mockImplementation((cb) => {
            changeCb = cb;
            return () => {};
        });
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const peerManager = { getConnectedPeerIds: vi.fn().mockReturnValue(['p2']), sendCrdtSync: vi.fn() };
        const sync = new AutomergeSync(peerManager);
        sync.start();

        changeCb?.(undefined);

        await vi.waitFor(() => {
            expect(peerManager.sendCrdtSync).toHaveBeenCalledWith({
                peerId: 'p2',
                message: expect.objectContaining({ docId: 'root' }),
            });
        });
    });
});
