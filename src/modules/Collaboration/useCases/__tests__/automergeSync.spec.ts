import { init as automergeInit, initSyncState, generateSyncMessage, type Doc } from '@automerge/automerge';
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

const command_mocks = vi.hoisted(() => ({
    reset_action_replay_authority: vi.fn<() => void>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    resetActionReplayAuthority: command_mocks.reset_action_replay_authority,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    subscribeToCrdtChanges: vi.fn(),
    getCrdtDoc: vi.fn(),
    createCrdtDoc: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn().mockReturnValue([]),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
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

describe('AutomergeSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('should revoke replay authority before installing an accepted remote document', () => {
        const order: string[] = [];
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        command_mocks.reset_action_replay_authority.mockImplementation(() => {
            order.push('reset-authority');
        });
        vi.mocked(replaceCrdtDoc).mockImplementation(() => {
            order.push('replace-document');
        });
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(sanitizeIncomingCrdtDocument).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['reset-authority', 'replace-document']);
    });

    it('should abort install and persistence when CrdtDocument sanitation fails', async () => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementationOnce(() => {
            throw new Error('sanitation failed');
        });
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(command_mocks.reset_action_replay_authority).not.toHaveBeenCalled();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
        expect(persistCrdtProject).not.toHaveBeenCalled();
    });

    it('§fix-1 drops a sync from a peer without edit capability (canApplySync=false)', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const canApplySync = vi.fn().mockReturnValue(false);
        const sync = new AutomergeSync(makePeerManager(), { canApplySync });

        sync.receiveSync({ peerId: 'viewer', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(canApplySync).toHaveBeenCalledWith('viewer', 'root');
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('§fix-1 applies a sync from a peer with edit capability (canApplySync=true)', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const canApplySync = vi.fn().mockReturnValue(true);
        const sync = new AutomergeSync(makePeerManager(), { canApplySync });

        sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

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

    it('addPeer sends the initial sync for the root doc to the new peer', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        expect(peerManager.sendCrdtSync).toHaveBeenCalledWith({
            peerId: 'p1',
            message: { type: 'crdt-sync', docId: 'root', data: expect.any(String) },
        });
    });

    it('addPeer also syncs the branch metadata doc when it exists', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(hasCrdtDoc).mockReturnValue(true);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
            const [{ message }] = call as [{ message: { docId: string } }];
            return message.docId;
        });
        expect(syncedDocIds).toContain('__branches__');
    });

    it('addPeer syncs branch content docs, skipping ids that are not branch-prefixed', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(getCrdtDocIds).mockReturnValue(['branch_a', 'other_doc']);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
            const [{ message }] = call as [{ message: { docId: string } }];
            return message.docId;
        });
        expect(syncedDocIds).toContain('branch_a');
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

    it('a bulk change with no docId hint syncs every connected peer via the full sweep', () => {
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

        expect(peerManager.sendCrdtSync).toHaveBeenCalledWith({
            peerId: 'p2',
            message: expect.objectContaining({ docId: 'root' }),
        });
    });
});
