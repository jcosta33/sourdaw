import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { branchStore } from '#/modules/CrdtDocument/stores';
import { createCrdtDoc, hasCrdtDoc, projectBranchSession } from '#/modules/CrdtDocument/useCases';

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
 * Collaboration teardown hands the durable branch list back to local writers,
 * and everything that closes the WebRTC peers runs after it. A refused
 * `localStorage` write used to unwind from there and leave live peers connected
 * to a session the user had already left.
 *
 * The branch-state authority and its storage are real here; only the peer
 * manager is a stub, because the assertion is about it being closed.
 */
const BRANCH_STATE_STORAGE_KEY = 'sourdaw-branch-state';
const MAIN_BRANCH_ID = 'main';

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

const preSessionList = { branches: [mainBranch, localOnlyBranch], activeBranchId: MAIN_BRANCH_ID };
const sessionProjectedList = { branches: [mainBranch], activeBranchId: MAIN_BRANCH_ID };

type StoredEnvelope = {
    version: number;
    revision: number;
    current: { branches: Array<{ branchId: string }>; activeBranchId: string };
    session: { owner: string; backup: unknown; baseRevision: number; sequence: number } | null;
};

function readStoredEnvelope(): StoredEnvelope | null {
    const raw = window.localStorage.getItem(BRANCH_STATE_STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as StoredEnvelope);
}

function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

function latestPeerManager(): (typeof runtimeIoMock.peerManagers)[number] {
    return runtimeIoMock.peerManagers.at(-1)!;
}

describe('collaboration teardown when branch storage refuses the write', () => {
    beforeEach(async () => {
        notifyUserMock.mockReset();
        runtimeIoMock.peerManagers.length = 0;
        window.localStorage.clear();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        // The list the user had before joining, already durable — this is what
        // the session claim takes as its backup.
        window.localStorage.setItem(
            BRANCH_STATE_STORAGE_KEY,
            JSON.stringify({ version: 1, revision: 1, current: preSessionList, session: null })
        );
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
        if (!hasCrdtDoc('root')) {
            createCrdtDoc('root');
        }

        await sessionRuntimePrimitives.initialize('project-owner-1');
        await sessionRuntimePrimitives.startBranchSync(false);
        // What a peer's branch list looks like once it has been projected: the
        // session owns the durable list and the local-only branch lives only in
        // the session record's backup.
        const claim = sessionRuntimePrimitives.state.branchSession;
        if (!claim) {
            throw new Error('Expected the session to claim the durable branch list');
        }
        const projected = await projectBranchSession(claim, sessionProjectedList);
        if (projected.status !== 'committed') {
            throw new Error(`Expected the session projection to commit (${projected.reason})`);
        }
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
        vi.unstubAllGlobals();
        window.localStorage.clear();
    });

    it('retires replacement resources and retries after durable reads recover', async () => {
        const { closeAll } = latestPeerManager();
        const refusedRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
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
        // The session record is the retry: the durable list still belongs to
        // this session, so nothing else can claim it and the next attempt can
        // still put the pre-session list back.
        expect(readStoredEnvelope()?.session).not.toBeNull();

        await expect(createSession('Replacement')).resolves.toEqual(expect.any(String));
        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
    });

    it('closes leave transport, clears runtime state, and retries after durable reads recover', async () => {
        const { closeAll } = latestPeerManager();
        const refusedRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
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
        expect(readStoredEnvelope()?.session).not.toBeNull();

        await expect(leaveSession()).resolves.toBeUndefined();
        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        expect(readStoredEnvelope()?.session).toBeNull();
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

    it('keeps the session record so the next boot can still restore a refused list', async () => {
        blockEveryDurableWrite();

        sessionRuntimePrimitives.cleanup();
        await expect(sessionRuntimePrimitives.settleRetainedTeardown()).rejects.toThrow(
            'Pre-session branch state could not be persisted'
        );

        vi.restoreAllMocks();
        const envelope = readStoredEnvelope();
        expect(envelope?.session?.backup).toEqual(preSessionList);
        // Memory still shows what the session published, and the durable list
        // agrees with it: the pre-session list comes back with the record, not
        // ahead of it.
        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([MAIN_BRANCH_ID]);
        expect(envelope?.current).toEqual(sessionProjectedList);
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

        it('says nothing and keeps the newer list when another instance took the branch list over', async () => {
            const envelope = readStoredEnvelope();
            if (!envelope?.session) {
                throw new Error('Expected a live session record');
            }
            const takenOver = {
                version: 1,
                revision: envelope.revision + 1,
                current: sessionProjectedList,
                session: { ...envelope.session, owner: 'another-instance' },
            };
            window.localStorage.setItem(BRANCH_STATE_STORAGE_KEY, JSON.stringify(takenOver));

            await expect(leaveSession()).resolves.toBeUndefined();

            // The defect this protocol exists to prevent: restoring this
            // session's backup over a list another instance now owns.
            expect(notifyUserMock).not.toHaveBeenCalled();
            expect(readStoredEnvelope()).toEqual(takenOver);
        });

        it('says nothing when the restore lands', async () => {
            await leaveSession();

            expect(notifyUserMock).not.toHaveBeenCalled();
            expect(readStoredEnvelope()?.session).toBeNull();
            expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
                MAIN_BRANCH_ID,
                localOnlyBranch.branchId,
            ]);
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

    it('reports no error and hands the durable list back when the write lands', async () => {
        sessionRuntimePrimitives.cleanup();
        await expect(sessionRuntimePrimitives.settleRetainedTeardown()).resolves.toBeUndefined();

        expect(branchStore.value?.branches.map((branch) => branch.branchId)).toEqual([
            MAIN_BRANCH_ID,
            localOnlyBranch.branchId,
        ]);
        expect(collaborationStore.value?.error ?? null).toBeNull();
        expect(readStoredEnvelope()?.session).toBeNull();
    });
});
