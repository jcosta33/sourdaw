import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { branchStore, MAIN_BRANCH_ID } from '#/modules/CrdtDocument/stores';
import { preserveBranchStateForSession } from '#/modules/CrdtDocument/useCases';

import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { sessionRuntimePrimitives } from '../sessionManagement';

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
    return { manager: { closeAll } as unknown as PeerConnectionManager, closeAll };
}

describe('collaboration teardown when localStorage refuses the write', () => {
    beforeEach(() => {
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

    it('restores the local branch list into the session and tells the user it was not saved', () => {
        sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;
        blockEveryDurableWrite();

        sessionRuntimePrimitives.cleanup();

        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        expect(collaborationStore.value?.error).toBe(
            'Left the session, but your local branch list could not be saved.'
        );
    });

    it('distinguishes a retained backup from a refused state write', () => {
        sessionRuntimePrimitives.state.peerManager = createClosablePeerManager().manager;
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        });

        sessionRuntimePrimitives.cleanup();

        // The branch list was saved. Telling the user it was not would be a
        // different lie from telling them nothing.
        expect(collaborationStore.value?.error).toBe(
            'Left the session. A leftover session backup could not be cleared, so your branch list may revert when you reopen the project.'
        );
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
