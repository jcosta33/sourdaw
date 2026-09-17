import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { type BranchStoreState } from '../../stores/branchStore';

import {
    blockEveryDurableWrite,
    bootBranchStateInstance,
    branchList,
    forkedBranch,
    installBranchStateLockManager,
    isBranchStateLockFree,
    lastRequestedSessionLockName,
    settleBranchStateLocks,
    loadBranchStateInstance,
    readStoredEnvelope,
    writeStoredEnvelope,
    type BranchStateInstance,
} from './branchStateHarness';

/**
 * The same list a peer's `__branches__` document hands back: identical values,
 * branch-record keys in another insertion order. `JSON.stringify` follows that
 * order, so only a canonical comparison can tell this is the list already
 * durable.
 */
function withReorderedKeys(state: BranchStoreState): BranchStoreState {
    return {
        activeBranchId: state.activeBranchId,
        branches: state.branches.map((record) => ({
            createdAt: record.createdAt,
            sourceBranchId: record.sourceBranchId,
            rootDocId: record.rootDocId,
            note: record.note,
            createdFromHeads: [...record.createdFromHeads],
            name: record.name,
            branchId: record.branchId,
        })),
    };
}

const feature = forkedBranch('feature', 'Feature');
const guest = forkedBranch('guest', 'Guest');
const hotfix = forkedBranch('hotfix', 'Hotfix');

describe('branchStateAuthority', () => {
    let manager: ControlledLockManager;

    beforeEach(() => {
        window.localStorage.clear();
        manager = installBranchStateLockManager();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Container.clear();
        window.localStorage.clear();
    });

    describe('ordinary writes', () => {
        it('commits against the revision the writer observed', async () => {
            const instance = await bootAt(5, branchList());
            const next = branchList(feature);

            const committed = await instance.authority.commit({ expectedRevision: 5, next });

            expect(committed).toEqual({ status: 'committed', revision: 6 });
            expect(instance.authority.captureRevision()).toBe(6);
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 6, current: next, session: null });
        });

        it('refuses a write whose observed revision another instance has moved past', async () => {
            const instance = await bootAt(5, branchList());
            const elsewhere = branchList(guest);
            writeStoredEnvelope({ version: 1, revision: 6, current: elsewhere, session: null });

            const refused = await instance.authority.commit({ expectedRevision: 5, next: branchList(feature) });

            expect(refused).toEqual({ status: 'refused', reason: 'conflict' });
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 6, current: elsewhere, session: null });
            // The refused writer is left holding the revision it has to retry
            // against, not the stale one it decided on.
            expect(instance.store.value).toEqual(elsewhere);
            expect(instance.authority.captureRevision()).toBe(6);
        });

        it('waits for the boot recovery instead of writing against a pre-recovery revision', async () => {
            const backup = branchList();
            writeStoredEnvelope({
                version: 1,
                revision: 7,
                current: branchList(feature),
                session: { owner: 'o1', backup, baseRevision: 6, sequence: 1 },
            });
            const instance = await loadBranchStateInstance();
            instance.authority.hydrateFromDurableState();

            // Never awaits `settleBoot` itself: the commit has to. Against the
            // pre-recovery revision 7 this would refuse `conflict`.
            const committed = await instance.authority.commit({ expectedRevision: 8, next: branchList(hotfix) });

            expect(committed).toEqual({ status: 'committed', revision: 9 });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 9,
                current: branchList(hotfix),
                session: null,
            });
        });

        it('takes over the branch list from a session this instance observed at boot', async () => {
            const owner = await beginForeignSession(5, branchList(feature));
            const observer = await bootBranchStateInstance();
            expect(observer.outcome).toBe('foreign-session-live');

            const superseded = await observer.authority.commit({ expectedRevision: 6, next: branchList(guest) });

            expect(superseded).toEqual({ status: 'committed', revision: 7 });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: branchList(guest),
                session: null,
            });

            // The licence was that one observed record and is spent: an
            // identical session record appearing afterwards is protected again.
            writeStoredEnvelope({
                version: 1,
                revision: 8,
                current: branchList(guest),
                session: { owner, backup: branchList(feature), baseRevision: 6, sequence: 0 },
            });

            const refused = await observer.authority.commit({ expectedRevision: 8, next: branchList(hotfix) });

            expect(refused).toEqual({ status: 'refused', reason: 'session-active' });
        });

        it('refuses a takeover whose observed revision the session has since moved past', async () => {
            const session = await beginForeignSession(5, branchList(feature));
            const observer = await bootBranchStateInstance();
            const projected = branchList(feature, guest);
            writeStoredEnvelope({
                version: 1,
                revision: 7,
                current: projected,
                session: { owner: session, backup: branchList(feature), baseRevision: 6, sequence: 1 },
            });

            const refused = await observer.authority.commit({ expectedRevision: 6, next: branchList(hotfix) });

            expect(refused).toEqual({ status: 'refused', reason: 'conflict' });
            expect(observer.store.value).toEqual(projected);
            expect(readStoredEnvelope()?.revision).toBe(7);
        });

        it('refuses a takeover of a different session than the one it observed', async () => {
            await beginForeignSession(5, branchList(feature));
            const observer = await bootBranchStateInstance();
            // The observed session ended and a new one began in its place.
            writeStoredEnvelope({
                version: 1,
                revision: 8,
                current: branchList(feature),
                session: { owner: 'o2', backup: branchList(feature), baseRevision: 8, sequence: 0 },
            });

            const refused = await observer.authority.commit({ expectedRevision: 8, next: branchList(hotfix) });

            expect(refused).toEqual({ status: 'refused', reason: 'session-active' });
            expect(readStoredEnvelope()?.session?.owner).toBe('o2');
        });

        it("keeps its own session's record when the session's instance writes locally", async () => {
            const instance = await bootAt(5, branchList(feature));
            const begun = await instance.authority.beginSession();
            if (begun.status !== 'begun') {
                throw new Error(`Expected a session, got ${begun.reason}`);
            }

            const committed = await instance.authority.commit({ expectedRevision: 6, next: branchList(hotfix) });

            expect(committed).toEqual({ status: 'committed', revision: 7 });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: branchList(hotfix),
                session: { owner: begun.handle.owner, backup: branchList(feature), baseRevision: 6, sequence: 0 },
            });
        });

        it('rolls a committed write back against the revision it produced', async () => {
            const instance = await bootAt(5, branchList());
            const previous = instance.store.value;
            const committed = await instance.authority.commit({ expectedRevision: 5, next: branchList(feature) });
            if (committed.status !== 'committed' || previous === null) {
                throw new Error('Expected the transition commit to land');
            }

            const rolledBack = await instance.authority.commit({
                expectedRevision: committed.revision,
                next: previous,
            });

            expect(rolledBack).toEqual({ status: 'committed', revision: 7 });
            expect(readStoredEnvelope()?.current).toEqual(previous);
        });

        it('refuses a rollback that a later write has already overtaken', async () => {
            const instance = await bootAt(5, branchList());
            const previous = branchList();
            const committed = await instance.authority.commit({ expectedRevision: 5, next: branchList(feature) });
            if (committed.status !== 'committed') {
                throw new Error('Expected the transition commit to land');
            }
            const successor = branchList(feature, guest);
            writeStoredEnvelope({ version: 1, revision: 7, current: successor, session: null });

            const refused = await instance.authority.commit({
                expectedRevision: committed.revision,
                next: previous,
            });

            expect(refused).toEqual({ status: 'refused', reason: 'conflict' });
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 7, current: successor, session: null });
            expect(instance.store.value).toEqual(successor);
        });

        it('leaves the projection on the last durable state when storage refuses the write', async () => {
            const current = branchList();
            const instance = await bootAt(5, current);
            const restoreWrites = blockEveryDurableWrite();

            const refused = await instance.authority.commit({ expectedRevision: 5, next: branchList(feature) });

            expect(refused).toEqual({ status: 'refused', reason: 'write-failed' });
            // Advancing either of these would let the next writer's revision
            // describe a write that never landed.
            expect(instance.store.value).toEqual(current);
            expect(instance.authority.captureRevision()).toBe(5);
            restoreWrites();
            expect(readStoredEnvelope()?.revision).toBe(5);
        });
    });

    describe('collaboration sessions', () => {
        it('records the session and holds its lifetime lock', async () => {
            const local = branchList(feature);
            const instance = await bootAt(5, local);

            const begun = await instance.authority.beginSession();

            expect(begun.status).toBe('begun');
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: local,
                session: {
                    owner: begun.status === 'begun' ? begun.handle.owner : '',
                    backup: local,
                    baseRevision: 6,
                    sequence: 0,
                },
            });
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(false);
        });

        it('refuses to begin over another session and releases the lock it took', async () => {
            await beginForeignSession(5, branchList(feature));
            const instance = await bootBranchStateInstance();

            const refused = await instance.authority.beginSession();

            expect(refused).toEqual({ status: 'refused', reason: 'session-active' });
            // The lifetime lock is taken before the record is read, so a
            // refusal has to give it back or the next boot reads this instance
            // as a live session forever.
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(true);
        });

        it('applies projections in call order', async () => {
            const instance = await bootAt(5, branchList(feature));
            const handle = await beginOwnSession(instance);
            const first = branchList(feature, guest);
            const second = branchList(feature, guest, hotfix);

            const projections = [
                instance.authority.projectSession(handle, first),
                instance.authority.projectSession(handle, second),
            ];

            await expect(Promise.all(projections)).resolves.toEqual([
                { status: 'committed', revision: 7 },
                { status: 'committed', revision: 8 },
            ]);
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 8,
                current: second,
                session: { owner: handle.owner, backup: branchList(feature), baseRevision: 6, sequence: 2 },
            });
        });

        /**
         * The mirror publishes a local commit into the `__branches__` doc, and
         * the change listener projects it straight back. Advancing the revision
         * for that echo refuses the next local transition, which captured the
         * revision the commit produced.
         */
        it('commits a projection of the list already durable without advancing the revision', async () => {
            const preSession = branchList();
            const instance = await bootAt(5, preSession);
            const handle = await beginOwnSession(instance);
            const committedLocally = branchList(feature);
            await expect(instance.authority.commit({ expectedRevision: 6, next: committedLocally })).resolves.toEqual({
                status: 'committed',
                revision: 7,
            });

            const echo = await instance.authority.projectSession(handle, committedLocally);

            expect(echo).toEqual({ status: 'committed', revision: 7 });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: committedLocally,
                session: { owner: handle.owner, backup: preSession, baseRevision: 6, sequence: 0 },
            });
            // The transition that started right after the commit still holds
            // revision 7, so it has to land.
            await expect(
                instance.authority.commit({ expectedRevision: 7, next: branchList(feature, guest) })
            ).resolves.toEqual({ status: 'committed', revision: 8 });
        });

        it('recognises the durable list through a document-materialised key order', async () => {
            const preSession = branchList();
            const instance = await bootAt(5, preSession);
            const handle = await beginOwnSession(instance);
            const committedLocally = branchList(feature);
            await instance.authority.commit({ expectedRevision: 6, next: committedLocally });

            const echo = await instance.authority.projectSession(handle, withReorderedKeys(committedLocally));

            expect(echo).toEqual({ status: 'committed', revision: 7 });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: committedLocally,
                session: { owner: handle.owner, backup: preSession, baseRevision: 6, sequence: 0 },
            });
            expect(instance.store.value).toEqual(committedLocally);
        });

        it('puts the pre-session list back and releases the lock when the session ends', async () => {
            const local = branchList(feature);
            const instance = await bootAt(5, local);
            const handle = await beginOwnSession(instance);
            await instance.authority.projectSession(handle, branchList(guest));

            await expect(instance.authority.endSession(handle)).resolves.toBe('restored');

            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 8, current: local, session: null });
            expect(instance.store.value).toEqual(local);
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(true);
        });

        it('stops projecting once the session no longer owns the list', async () => {
            const instance = await bootAt(5, branchList(feature));
            const handle = await beginOwnSession(instance);
            const takenOver = branchList(guest);
            writeStoredEnvelope({ version: 1, revision: 7, current: takenOver, session: null });

            const refused = await instance.authority.projectSession(handle, branchList(hotfix));

            expect(refused).toEqual({ status: 'refused', reason: 'superseded' });
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 7, current: takenOver, session: null });
            expect(instance.store.value).toEqual(takenOver);
        });

        it('reports a superseded session at the end without replaying its backup', async () => {
            const instance = await bootAt(5, branchList(feature));
            const handle = await beginOwnSession(instance);
            const takenOver = branchList(guest);
            writeStoredEnvelope({ version: 1, revision: 7, current: takenOver, session: null });

            await expect(instance.authority.endSession(handle)).resolves.toBe('superseded');

            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 7, current: takenOver, session: null });
            expect(instance.store.value).toEqual(takenOver);
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(true);
        });

        it('keeps the session live when its restore cannot be written, and finishes on retry', async () => {
            const local = branchList(feature);
            const instance = await bootAt(5, local);
            const handle = await beginOwnSession(instance);
            const restoreWrites = blockEveryDurableWrite();

            await expect(instance.authority.endSession(handle)).resolves.toBe('write-failed');

            restoreWrites();
            // Still durable and still locked: a retry has to be able to finish
            // the restore, and a booting instance must keep seeing this session
            // as live until it does.
            expect(readStoredEnvelope()?.session?.owner).toBe(handle.owner);
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(false);

            await expect(instance.authority.endSession(handle)).resolves.toBe('restored');

            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 7, current: local, session: null });
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(true);
        });

        it('refuses a projection that arrives after the session ended', async () => {
            const local = branchList(feature);
            const instance = await bootAt(5, local);
            const handle = await beginOwnSession(instance);
            await instance.authority.projectSession(handle, branchList(guest));
            await instance.authority.endSession(handle);

            const refused = await instance.authority.projectSession(handle, branchList(hotfix));

            expect(refused).toEqual({ status: 'refused', reason: 'superseded' });
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 8, current: local, session: null });
        });

        it('never replays a crashed session backup over a branch a later instance committed', async () => {
            // #4249. Instance A sessions with {Main, feature}, projects a peer
            // list, and dies mid-session.
            const local = branchList(feature);
            const crashed = await bootAt(5, local);
            const handle = await beginOwnSession(crashed);
            await crashed.authority.projectSession(handle, branchList(feature, guest));
            manager = installBranchStateLockManager();

            // Instance B boots, finds the lifetime lock free, restores A's
            // backup, and the user forks a branch of their own.
            const survivor = await bootBranchStateInstance();
            expect(survivor.outcome).toBe('restored');
            const forked = branchList(feature, hotfix);
            const committed = await survivor.authority.commit({
                expectedRevision: survivor.authority.captureRevision(),
                next: forked,
            });
            expect(committed).toEqual({ status: 'committed', revision: 9 });

            // Instance A restarts. Its backup is long gone from the envelope,
            // and the fork has to survive.
            const restarted = await bootBranchStateInstance();

            expect(restarted.outcome).toBe('settled');
            expect(restarted.store.value).toEqual(forked);
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 9, current: forked, session: null });
        });

        it('restores its own abandoned session when it restarts alone', async () => {
            const local = branchList(feature);
            const crashed = await bootAt(5, local);
            const handle = await beginOwnSession(crashed);
            await crashed.authority.projectSession(handle, branchList(feature, guest));
            manager = installBranchStateLockManager();

            const restarted = await bootBranchStateInstance();

            expect(restarted.outcome).toBe('restored');
            expect(restarted.store.value).toEqual(local);
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 8, current: local, session: null });
        });
    });

    async function bootAt(revision: number, current: BranchStoreState): Promise<BranchStateInstance> {
        writeStoredEnvelope({ version: 1, revision, current, session: null });
        const instance = await bootBranchStateInstance();
        return instance;
    }

    async function beginOwnSession(instance: BranchStateInstance): Promise<{ owner: string }> {
        const begun = await instance.authority.beginSession();
        if (begun.status !== 'begun') {
            throw new Error(`Expected a session, got ${begun.reason}`);
        }
        return begun.handle;
    }

    /** A session begun by another instance, whose lifetime lock stays held. */
    async function beginForeignSession(revision: number, current: BranchStoreState): Promise<string> {
        const other = await bootAt(revision, current);
        const handle = await beginOwnSession(other);
        return handle.owner;
    }
});
