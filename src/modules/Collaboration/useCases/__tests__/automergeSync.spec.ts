import { init as automergeInit, initSyncState, generateSyncMessage, type Doc } from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { subscribeToCrdtChanges, getCrdtDoc, createCrdtDoc, replaceCrdtDoc } from '#/modules/CrdtDocument/useCases';
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

        expect(order).toEqual(['reset-authority', 'replace-document']);
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
            changeCb = cb as (docId?: string) => void;
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
});
