import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { branchStore, MAIN_BRANCH_ID } from '#/modules/CrdtDocument/stores';
import { preserveBranchStateForSession } from '#/modules/CrdtDocument/useCases';

import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { leaveSession } from '../leaveSession';
import { sessionRuntimePrimitives } from '../sessionManagement';

const notifyUserMock = vi.hoisted(() =>
    vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>()
);
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

/**
 * Collaboration teardown runs `restoreBranchStateAfterSession` inside a
 * `try`/`finally` with no `catch`, and everything that closes the WebRTC peers
 * runs after it. A refused `localStorage` write used to unwind from there and
 * leave live peers connected to a session the user had already left.
 *
 * The branch store and its `createLocalStorage` adapter are real here; only the
 * peer manager is a stub, because the assertion is about it being closed.
 */
const mainBranch = {
    branchId: MAIN_BRANCH_ID,
    name: 'Main',
    rootDocId: 'root',
    sourceBranchId: null,
    createdAt: 100,
    createdFromHeads: [],
    note: '',
};

const localOnlyBranch = {
    branchId: 'local-only',
    name: 'Local only',
    rootDocId: 'branch_local_only',
    sourceBranchId: MAIN_BRANCH_ID,
    createdAt: 200,
    createdFromHeads: [],
    note: '',
};

function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

function createClosablePeerManager(): { manager: PeerConnectionManager; closeAll: ReturnType<typeof vi.fn> } {
    const closeAll = vi.fn();
    const manager = {
        closeAll,
        getConnectedPeerIds: vi.fn(() => []),
        sendCrdtSyncBuffered: vi.fn(() => Promise.resolve()),
    };
    return { manager: manager as unknown as PeerConnectionManager, closeAll };
}

describe('collaboration teardown when localStorage refuses the write', () => {
    beforeEach(() => {
        notifyUserMock.mockReset();
        window.localStorage.clear();
        collaborationStore.set({
            isEnabled: true,
            sessionId: 'session-1',
            localPeerId: 'me',
            localName: 'Alice',
            localColor: '#3b82f6',
            isHost: false,
            peers: [],
            connectionStatus: 'connected',
            error: null,
            quarantinedPeerIds: [],
        });
        branchStore.set({ branches: [mainBranch, localOnlyBranch], activeBranchId: MAIN_BRANCH_ID });

        // What `startBranchSync` does: stash the local list, then let the host's
        // projected list replace it for the duration of the session.
        preserveBranchStateForSession();
        sessionRuntimePrimitives.state.hasBranchStateBackup = true;
        branchStore.set({ branches: [mainBranch], activeBranchId: MAIN_BRANCH_ID });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionRuntimePrimitives.state.hasBranchStateBackup = false;
        sessionRuntimePrimitives.state.peerManager = null;
        window.localStorage.clear();
    });

    it('closes every peer even when the pre-session branch list cannot be persisted', () => {
        const { manager, closeAll } = createClosablePeerManager();
        sessionRuntimePrimitives.state.peerManager = manager;
        blockEveryDurableWrite();

        sessionRuntimePrimitives.cleanup();

        expect(closeAll).toHaveBeenCalledTimes(1);
        expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
    });

    it('restores the local branch list into the session even when it cannot be persisted', () => {
        sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;
        blockEveryDurableWrite();

        sessionRuntimePrimitives.cleanup();

        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
    });

    /**
     * Driven through `leaveSession`, which is what the Leave button binds to —
     * not `cleanup()`, the internal step. All three callers of
     * `cleanupSubsystems` overwrite the whole collaboration store with
     * `error: null` immediately afterwards (`leaveSession.ts:27`,
     * `createSession.ts:16`, `joinSession.ts:43`), so a message written to
     * `collaborationStore.error` during teardown is erased synchronously before
     * anything can render it. A spec that stops at `cleanup()` is green while
     * the product is silent.
     */
    describe('through the path the Leave button actually takes', () => {
        it('tells the user the branch list was not saved, and the message survives teardown', async () => {
            sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;
            blockEveryDurableWrite();

            await leaveSession();

            expect(notifyUserMock).toHaveBeenCalledTimes(1);
            const [message, level] = notifyUserMock.mock.calls[0] ?? [];
            expect(message).toContain('branch list could not be saved');
            expect(message).toContain('Free up storage space');
            expect(level).toBe('error');
            // The store field this used to use is wiped by leaveSession itself.
            expect(collaborationStore.value?.error ?? null).toBeNull();
        });

        it('tells the user a leftover backup survived, with its own message', async () => {
            sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;
            vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            });

            await leaveSession();

            expect(notifyUserMock.mock.calls[0]?.[0]).toContain('leftover session backup');
        });

        it('says nothing when the restore lands', async () => {
            sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;

            await leaveSession();

            expect(notifyUserMock).not.toHaveBeenCalled();
        });

        /**
         * A `vi.fn()` mock removes the only thing that can unwind teardown, so
         * the peer-closure assertions above run against a path that no longer
         * resembles production. In the real failure `notifyUser` throws:
         * `inject` caches the closure it builds on first call, and an
         * unregistered `NotificationEventBus` token resolves to the abstract
         * class rather than throwing, so the cached closure calls `emit` on a
         * class that has none. Reporting must survive that, because it is the
         * last thing teardown does and the peers are already closed.
         */
        it('closes the peers even if reporting itself throws', async () => {
            const { manager, closeAll } = createClosablePeerManager();
            sessionRuntimePrimitives.state.peerManager = manager;
            blockEveryDurableWrite();
            notifyUserMock.mockImplementation(() => {
                throw new TypeError('eventBus.emit is not a function');
            });

            await expect(leaveSession()).rejects.toThrow('eventBus.emit is not a function');

            expect(notifyUserMock).toHaveBeenCalledTimes(1);
            expect(closeAll).toHaveBeenCalledTimes(1);
            expect(sessionRuntimePrimitives.state.automergeSync).toBeNull();
            expect(sessionRuntimePrimitives.state.cleanupProjectionBridge).toBeNull();
        });
    });

    it('reports no error and consumes the backup when the write lands', () => {
        sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;

        sessionRuntimePrimitives.cleanup();

        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        expect(collaborationStore.value?.error ?? null).toBeNull();
        expect(window.localStorage.getItem('sourdaw-branch-session-backup')).toBeNull();
    });
});
