import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { branchStore, MAIN_BRANCH_ID } from '#/modules/CrdtDocument/stores';
import { createCrdtDoc, hasCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { collaborationStore } from '../../../stores/collaborationStore';
import { createSession } from '../createSession';
import { leaveSession } from '../leaveSession';
import { sessionRuntimePrimitives } from '../sessionManagement';

const notifyUserMock = vi.hoisted(() =>
    vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>()
);
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

const runtimeIoMock = vi.hoisted(() => ({
    peerManagers: [] as Array<{
        closeAll: ReturnType<typeof vi.fn>;
        getConnectedPeerIds: ReturnType<typeof vi.fn>;
        sendCrdtSyncBuffered: ReturnType<typeof vi.fn>;
    }>,
}));

const crdtPersistenceMock = vi.hoisted(() => ({
    runCrdtPersistenceBarrier: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    runCrdtPersistenceBarrier: crdtPersistenceMock.runCrdtPersistenceBarrier,
}));

vi.mock('../../../repositories/peerConnection', () => ({
    PeerConnectionManager: vi.fn().mockImplementation(function () {
        const manager = {
            closeAll: vi.fn(),
            getConnectedPeerIds: vi.fn().mockReturnValue([]),
            sendCrdtSyncBuffered: vi.fn().mockResolvedValue(undefined),
        };
        runtimeIoMock.peerManagers.push(manager);
        return manager;
    }),
}));

vi.mock('../getCollaborationAssetOwnerId', () => ({
    collaborationAssetOwnership: { getOwnerId: () => 'project-owner-1' },
}));

vi.mock('../../automergeSync', () => ({
    AutomergeSync: vi.fn().mockImplementation(function () {
        return {
            start: vi.fn(),
            stop: vi.fn(),
            settleDurableTeardown: vi.fn().mockResolvedValue(undefined),
        };
    }),
}));

vi.mock('../../assetTransfer', () => ({
    AssetTransfer: vi.fn().mockImplementation(function () {
        return {
            dispose: vi.fn(),
        };
    }),
}));

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

function latestPeerManager(): (typeof runtimeIoMock.peerManagers)[number] {
    return runtimeIoMock.peerManagers.at(-1)!;
}

describe('collaboration teardown when localStorage refuses the write', () => {
    beforeEach(async () => {
        notifyUserMock.mockReset();
        runtimeIoMock.peerManagers.length = 0;
        window.localStorage.clear();
        crdtPersistenceMock.runCrdtPersistenceBarrier.mockImplementation(
            async (
                operation: (input: {
                    persistCurrentProject: (expectedRootHeads?: readonly string[]) => Promise<unknown>;
                }) => Promise<void>
            ) => {
                let result: unknown = { status: 'skipped', reason: 'operation-declined', durable: { write: 'none' } };
                await operation({
                    persistCurrentProject: async (expectedRootHeads) => {
                        result = {
                            status: 'settled',
                            mode: expectedRootHeads ? 'exact' : 'ordinary',
                            expectedRootHeads: expectedRootHeads ? [...expectedRootHeads] : undefined,
                            durable: {
                                write: 'noop',
                                authority: { epoch: 'test', revision: 1, rootLineage: 'main' },
                            },
                        };
                        return result;
                    },
                });
                return result;
            }
        );
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
        if (!hasCrdtDoc('root')) {
            createCrdtDoc('root');
        }

        await sessionRuntimePrimitives.initialize('project-owner-1');
        sessionRuntimePrimitives.startBranchSync(false);
        branchStore.set({ branches: [mainBranch], activeBranchId: MAIN_BRANCH_ID });
    });

    afterEach(async () => {
        try {
            sessionRuntimePrimitives.cleanup();
        } catch {
            // The reporting-throws case deliberately makes cleanup throw after
            // all runtime resources have already been removed.
        }
        vi.restoreAllMocks();
        await sessionRuntimePrimitives.settleRetainedTeardown().catch(() => undefined);
        window.localStorage.clear();
    });

    it('retires replacement resources and retries after durable reads recover', async () => {
        const refusal = new DOMException('The operation is insecure.', 'SecurityError');
        const { closeAll } = latestPeerManager();
        const refusedRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw refusal;
        });
        let failure: unknown;

        try {
            await createSession('Replacement');
        } catch (error) {
            failure = error;
        }
        refusedRead.mockRestore();

        expect(closeAll).toHaveBeenCalledTimes(1);
        expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
        expect(sessionRuntimePrimitives.state.automergeSync).toBeNull();
        expect(sessionRuntimePrimitives.state.assetTransfer).toBeNull();
        expect(sessionRuntimePrimitives.state.cleanupProjectionBridge).toBeNull();
        expect(failure).toEqual(expect.objectContaining({ message: 'Pre-session branch state could not be read' }));
        expect(notifyUserMock.mock.calls[0]?.[0]).toContain('branch storage could not be read');
        expect(window.localStorage.getItem('sourdaw-branch-session-backup')).not.toBeNull();

        await expect(createSession('Replacement')).resolves.toEqual(expect.any(String));
        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
    });

    it('closes leave transport, clears runtime state, and retries after durable reads recover', async () => {
        const refusal = new DOMException('The operation is insecure.', 'SecurityError');
        const { closeAll } = latestPeerManager();
        const refusedRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw refusal;
        });
        let failure: unknown;

        try {
            await leaveSession();
        } catch (error) {
            failure = error;
        }
        refusedRead.mockRestore();

        expect(closeAll).toHaveBeenCalledTimes(1);
        expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
        expect(sessionRuntimePrimitives.state.automergeSync).toBeNull();
        expect(sessionRuntimePrimitives.state.assetTransfer).toBeNull();
        expect(sessionRuntimePrimitives.state.cleanupProjectionBridge).toBeNull();
        expect(failure).toEqual(expect.objectContaining({ message: 'Pre-session branch state could not be read' }));
        expect(window.localStorage.getItem('sourdaw-branch-session-backup')).not.toBeNull();

        await expect(leaveSession()).resolves.toBeUndefined();
        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        expect(window.localStorage.getItem('sourdaw-branch-session-backup')).toBeNull();
    });

    it('closes every peer even when the pre-session branch list cannot be persisted', async () => {
        const { closeAll } = latestPeerManager();
        blockEveryDurableWrite();

        sessionRuntimePrimitives.cleanup();

        expect(closeAll).toHaveBeenCalledTimes(1);
        expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
        await expect(sessionRuntimePrimitives.settleRetainedTeardown()).rejects.toThrow(
            'Pre-session branch state could not be persisted'
        );
    });

    it('restores the local branch list into the session even when it cannot be persisted', async () => {
        blockEveryDurableWrite();

        sessionRuntimePrimitives.cleanup();

        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        await expect(sessionRuntimePrimitives.settleRetainedTeardown()).rejects.toThrow(
            'Pre-session branch state could not be persisted'
        );
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
            blockEveryDurableWrite();

            await expect(leaveSession()).rejects.toThrow('Pre-session branch state could not be persisted');

            expect(notifyUserMock).toHaveBeenCalledTimes(1);
            const [message, level] = notifyUserMock.mock.calls[0] ?? [];
            expect(message).toContain('branch list could not be saved');
            expect(message).toContain('Free up storage space');
            expect(level).toBe('error');
            // The store field this used to use is wiped by leaveSession itself.
            expect(collaborationStore.value?.error ?? null).toBeNull();
        });

        it('tells the user a leftover backup survived, with its own message', async () => {
            const blockedRemoval = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            });

            await expect(leaveSession()).rejects.toThrow('Pre-session branch backup could not be cleared');

            expect(notifyUserMock.mock.calls[0]?.[0]).toContain('leftover session backup');
            expect(window.localStorage.getItem('sourdaw-branch-session-backup')).not.toBeNull();

            blockedRemoval.mockRestore();

            await expect(leaveSession()).resolves.toBeUndefined();
            expect(window.localStorage.getItem('sourdaw-branch-session-backup')).toBeNull();
            expect(notifyUserMock).toHaveBeenCalledTimes(1);
        });

        it('says nothing when the restore lands', async () => {
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
            const { closeAll } = latestPeerManager();
            blockEveryDurableWrite();
            notifyUserMock.mockImplementation(() => {
                throw new TypeError('eventBus.emit is not a function');
            });

            await expect(leaveSession()).rejects.toThrow('Pre-session branch state could not be persisted');

            expect(notifyUserMock).toHaveBeenCalledTimes(1);
            expect(closeAll).toHaveBeenCalledTimes(1);
            expect(sessionRuntimePrimitives.state.automergeSync).toBeNull();
            expect(sessionRuntimePrimitives.state.cleanupProjectionBridge).toBeNull();
        });
    });

    it('reports no error and consumes the backup when the write lands', async () => {
        sessionRuntimePrimitives.cleanup();
        await expect(sessionRuntimePrimitives.settleRetainedTeardown()).resolves.toBeUndefined();

        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        expect(collaborationStore.value?.error ?? null).toBeNull();
        expect(window.localStorage.getItem('sourdaw-branch-session-backup')).toBeNull();
    });
});
