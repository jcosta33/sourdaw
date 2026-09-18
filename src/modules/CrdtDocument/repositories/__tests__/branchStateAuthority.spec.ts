import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { type BranchStoreState } from '../../stores/branchStore';

import {
    blockEveryDurableWrite,
    bootBranchStateInstance,
    branchList,
    forkedBranch,
    holdBranchStateLock,
    installBranchStateLockManager,
    isBranchStateLockFree,
    lastRequestedResetLockName,
    lastRequestedSessionLockName,
    resetLockName,
    settleBranchStateLocks,
    loadBranchStateInstance,
    readStoredEnvelope,
    writeStoredEnvelope,
    type BranchStateInstance,
    type StoredPersistenceAuthority,
    type StoredResetRecord,
} from './branchStateHarness';

const mocks = vi.hoisted(() => ({
    loadPersistenceSnapshotFromIdb: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
}));

/**
 * The durable persistence authority is what a boot compares a reset marker
 * against, so it is the one dependency these cases drive. Mocked at its module
 * rather than through a fake IndexedDB because `loadBranchStateInstance`
 * rebuilds the module graph per instance, and a `vi.mock` factory is the only
 * seam both graphs resolve to the same object.
 */
vi.mock('../crdtPersistence/loadPersistenceSnapshotFromIdb', () => ({
    loadPersistenceSnapshotFromIdb: mocks.loadPersistenceSnapshotFromIdb,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError, warn: mocks.loggerWarn, info: vi.fn(), debug: vi.fn() },
}));

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

/** The authority the outgoing project holds, and the one its replacement will write. */
const outgoingAuthority: StoredPersistenceAuthority = { epoch: 'epoch-outgoing', revision: 4, rootLineage: 'main' };
const replacementAuthority: StoredPersistenceAuthority = {
    epoch: 'epoch-replacement',
    revision: 5,
    rootLineage: 'main',
};

describe('branchStateAuthority', () => {
    let manager: ControlledLockManager;

    beforeEach(() => {
        window.localStorage.clear();
        manager = installBranchStateLockManager();
        mocks.loadPersistenceSnapshotFromIdb.mockReset();
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue(null);
        mocks.loggerError.mockReset();
        mocks.loggerWarn.mockReset();
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
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: next,
                session: null,
                reset: null,
            });
        });

        it('refuses a write whose observed revision another instance has moved past', async () => {
            const instance = await bootAt(5, branchList());
            const elsewhere = branchList(guest);
            writeStoredEnvelope({ version: 1, revision: 6, current: elsewhere, session: null, reset: null });

            const refused = await instance.authority.commit({ expectedRevision: 5, next: branchList(feature) });

            expect(refused).toEqual({ status: 'refused', reason: 'conflict' });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: elsewhere,
                session: null,
                reset: null,
            });
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
                reset: null,
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
                reset: null,
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
                reset: null,
            });

            // The licence was that one observed record and is spent: an
            // identical session record appearing afterwards is protected again.
            writeStoredEnvelope({
                version: 1,
                revision: 8,
                current: branchList(guest),
                session: { owner, backup: branchList(feature), baseRevision: 6, sequence: 0 },
                reset: null,
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
                reset: null,
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
                reset: null,
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
                reset: null,
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
            writeStoredEnvelope({ version: 1, revision: 7, current: successor, session: null, reset: null });

            const refused = await instance.authority.commit({
                expectedRevision: committed.revision,
                next: previous,
            });

            expect(refused).toEqual({ status: 'refused', reason: 'conflict' });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: successor,
                session: null,
                reset: null,
            });
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
                reset: null,
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
                reset: null,
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
                reset: null,
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
                reset: null,
            });
            expect(instance.store.value).toEqual(committedLocally);
        });

        it('puts the pre-session list back and releases the lock when the session ends', async () => {
            const local = branchList(feature);
            const instance = await bootAt(5, local);
            const handle = await beginOwnSession(instance);
            await instance.authority.projectSession(handle, branchList(guest));

            await expect(instance.authority.endSession(handle)).resolves.toBe('restored');

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 8,
                current: local,
                session: null,
                reset: null,
            });
            expect(instance.store.value).toEqual(local);
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(true);
        });

        it('stops projecting once the session no longer owns the list', async () => {
            const instance = await bootAt(5, branchList(feature));
            const handle = await beginOwnSession(instance);
            const takenOver = branchList(guest);
            writeStoredEnvelope({ version: 1, revision: 7, current: takenOver, session: null, reset: null });

            const refused = await instance.authority.projectSession(handle, branchList(hotfix));

            expect(refused).toEqual({ status: 'refused', reason: 'superseded' });
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: takenOver,
                session: null,
                reset: null,
            });
            expect(instance.store.value).toEqual(takenOver);
        });

        it('reports a superseded session at the end without replaying its backup', async () => {
            const instance = await bootAt(5, branchList(feature));
            const handle = await beginOwnSession(instance);
            const takenOver = branchList(guest);
            writeStoredEnvelope({ version: 1, revision: 7, current: takenOver, session: null, reset: null });

            await expect(instance.authority.endSession(handle)).resolves.toBe('superseded');

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: takenOver,
                session: null,
                reset: null,
            });
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

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: local,
                session: null,
                reset: null,
            });
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
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 8,
                current: local,
                session: null,
                reset: null,
            });
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
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 9,
                current: forked,
                session: null,
                reset: null,
            });
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
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 8,
                current: local,
                session: null,
                reset: null,
            });
        });
    });

    describe('project resets', () => {
        it('records the reset before the outgoing project is destroyed', async () => {
            const current = branchList(feature);
            const instance = await bootAt(5, current);
            const intended = branchList();

            const begun = await beginReset(instance, intended);

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current,
                session: null,
                reset: {
                    owner: begun.owner,
                    old: outgoingAuthority,
                    target: replacementAuthority,
                    previous: current,
                    intended,
                },
            });
            expect(lastRequestedResetLockName(manager)).toBe(resetLockName(begun.owner));
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(false);
        });

        it('refuses to reset while a collaboration session owns the durable list', async () => {
            await beginForeignSession(5, branchList(feature));
            const instance = await bootBranchStateInstance();
            const before = readStoredEnvelope();

            const refused = await instance.authority.beginReset({
                old: outgoingAuthority,
                target: replacementAuthority,
                intended: branchList(),
            });

            expect(refused).toEqual({ status: 'refused', reason: 'session-active' });
            expect(readStoredEnvelope()).toEqual(before);
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedResetLockName(manager))).resolves.toBe(true);
        });

        it('refuses to begin a second reset over one already recorded', async () => {
            const current = branchList(feature);
            const marker = storedReset('other-instance', current, branchList());
            writeStoredEnvelope({ version: 1, revision: 5, current, session: null, reset: marker });
            const releaseForeignReset = holdBranchStateLock(manager, resetLockName('other-instance'));
            const instance = await bootBranchStateInstance();
            expect(instance.outcome).toBe('reset-live');

            const refused = await instance.authority.beginReset({
                old: outgoingAuthority,
                target: replacementAuthority,
                intended: branchList(),
            });

            expect(refused).toEqual({ status: 'refused', reason: 'reset-active' });
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 5, current, session: null, reset: marker });
            releaseForeignReset();
        });

        it('refuses an ordinary branch write while a reset owns the envelope', async () => {
            const current = branchList(feature);
            const instance = await bootAt(5, current);
            await beginReset(instance, branchList());
            const before = readStoredEnvelope();

            const refused = await instance.authority.commit({ expectedRevision: 6, next: branchList(hotfix) });

            expect(refused).toEqual({ status: 'refused', reason: 'reset-pending' });
            expect(readStoredEnvelope()).toEqual(before);
        });

        it('refuses to begin a collaboration session while a reset owns the envelope', async () => {
            const instance = await bootAt(5, branchList(feature));
            await beginReset(instance, branchList());

            const refused = await instance.authority.beginSession();

            expect(refused).toEqual({ status: 'refused', reason: 'reset-pending' });
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, lastRequestedSessionLockName(manager))).resolves.toBe(true);
        });

        it('publishes the replacement list and clears the marker once the target authority is durable', async () => {
            const instance = await bootAt(5, branchList(feature));
            const intended = branchList();
            const begun = await beginReset(instance, intended);

            await expect(instance.authority.finalizeReset(begun, replacementAuthority)).resolves.toBe('finalized');

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: intended,
                session: null,
                reset: null,
            });
            expect(instance.store.value).toEqual(intended);
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(true);
        });

        it('leaves the reset pending when the durable authority is still the outgoing one', async () => {
            const instance = await bootAt(5, branchList(feature));
            const begun = await beginReset(instance, branchList());
            const before = readStoredEnvelope();

            await expect(instance.authority.finalizeReset(begun, outgoingAuthority)).resolves.toBe(
                'authority-mismatch'
            );

            expect(readStoredEnvelope()).toEqual(before);
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(false);
        });

        /**
         * An incremental save landed between the replacement's snapshot and
         * this call, so the committed authority carries a later revision under
         * the epoch this reset minted. It is still this replacement.
         */
        it('finalizes against a replacement authority an ordinary save has advanced', async () => {
            const instance = await bootAt(5, branchList(feature));
            const intended = branchList();
            const begun = await beginReset(instance, intended);

            await expect(
                instance.authority.finalizeReset(begun, {
                    ...replacementAuthority,
                    revision: replacementAuthority.revision + 1,
                })
            ).resolves.toBe('finalized');

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: intended,
                session: null,
                reset: null,
            });
            expect(instance.store.value).toEqual(intended);
        });

        it('leaves the reset pending when the replacement committed under another root lineage', async () => {
            const instance = await bootAt(5, branchList(feature));
            const begun = await beginReset(instance, branchList());
            const before = readStoredEnvelope();

            await expect(
                instance.authority.finalizeReset(begun, {
                    ...replacementAuthority,
                    rootLineage: 'lineage-forked',
                })
            ).resolves.toBe('authority-mismatch');

            expect(readStoredEnvelope()).toEqual(before);
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(false);
        });

        it('leaves the reset pending when no save of the replacement committed at all', async () => {
            const instance = await bootAt(5, branchList(feature));
            const begun = await beginReset(instance, branchList());
            const before = readStoredEnvelope();

            await expect(instance.authority.finalizeReset(begun, null)).resolves.toBe('authority-mismatch');

            expect(readStoredEnvelope()).toEqual(before);
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(false);
        });

        it('reports a reset another instance already settled without writing over its list', async () => {
            const instance = await bootAt(5, branchList(feature));
            const begun = await beginReset(instance, branchList());
            const settledElsewhere = branchList(guest);
            writeStoredEnvelope({
                version: 1,
                revision: 7,
                current: settledElsewhere,
                session: null,
                reset: null,
            });

            await expect(instance.authority.finalizeReset(begun, replacementAuthority)).resolves.toBe('superseded');

            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 7,
                current: settledElsewhere,
                session: null,
                reset: null,
            });
            expect(instance.store.value).toEqual(settledElsewhere);
            await settleBranchStateLocks();
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(true);
        });

        it('keeps the reset pending when its finalization cannot be written, and finishes on retry', async () => {
            const instance = await bootAt(5, branchList(feature));
            const intended = branchList();
            const begun = await beginReset(instance, intended);
            const before = readStoredEnvelope();
            const restoreWrites = blockEveryDurableWrite();

            await expect(instance.authority.finalizeReset(begun, replacementAuthority)).resolves.toBe('write-failed');

            restoreWrites();
            expect(readStoredEnvelope()).toEqual(before);
            await expect(isBranchStateLockFree(manager, resetLockName(begun.owner))).resolves.toBe(false);

            await expect(instance.authority.finalizeReset(begun, replacementAuthority)).resolves.toBe('finalized');

            expect(readStoredEnvelope()?.reset).toBeNull();
            expect(readStoredEnvelope()?.current).toEqual(intended);
        });
    });

    describe('boot classification of an abandoned reset', () => {
        const current = branchList(feature);
        const previous = branchList(feature, guest);
        const intended = branchList();

        function writeAbandonedReset(): StoredResetRecord {
            const marker = storedReset('crashed-instance', previous, intended);
            writeStoredEnvelope({ version: 1, revision: 5, current, session: null, reset: marker });
            return marker;
        }

        it('leaves a reset alone while the instance performing it is still alive', async () => {
            const marker = writeAbandonedReset();
            const releaseReset = holdBranchStateLock(manager, resetLockName('crashed-instance'));

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-live');
            expect(booted.store.value).toEqual(current);
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 5, current, session: null, reset: marker });
            releaseReset();
        });

        it('rolls the reset back when the outgoing project is still the durable one', async () => {
            writeAbandonedReset();
            durableAuthority(outgoingAuthority);

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-rolled-back');
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: previous,
                session: null,
                reset: null,
            });
            expect(booted.store.value).toEqual(previous);
        });

        it('finalizes the reset when the replacement reached storage', async () => {
            writeAbandonedReset();
            durableAuthority(replacementAuthority);

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-finalized');
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: intended,
                session: null,
                reset: null,
            });
            expect(booted.store.value).toEqual(intended);
        });

        /**
         * Another tab saved the outgoing project after this reset read its
         * authority. The durable project is still plainly the outgoing one —
         * a save advances the revision, it does not change which project is
         * on disk — so the reset rolls back rather than stranding the marker.
         */
        it('rolls the reset back when the outgoing project was saved after the reset read it', async () => {
            writeAbandonedReset();
            durableAuthority({ ...outgoingAuthority, revision: outgoingAuthority.revision + 1 });

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-rolled-back');
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: previous,
                session: null,
                reset: null,
            });
            expect(booted.store.value).toEqual(previous);
        });

        /**
         * The mirror case: the replacement reached storage and then took an
         * ordinary save — the user pressing Cmd+S after a finalization that
         * could not be written. The replacement is the durable project.
         */
        it('finalizes the reset when the replacement was saved again after it reached storage', async () => {
            writeAbandonedReset();
            durableAuthority({ ...replacementAuthority, revision: replacementAuthority.revision + 1 });

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-finalized');
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: intended,
                session: null,
                reset: null,
            });
            expect(booted.store.value).toEqual(intended);
        });

        it('leaves the marker when a fork moved the outgoing project to another root lineage', async () => {
            const marker = writeAbandonedReset();
            const forked = { ...outgoingAuthority, rootLineage: 'lineage-forked' };
            durableAuthority(forked);

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-unavailable');
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 5, current, session: null, reset: marker });
            expect(booted.store.value).toEqual(current);
            expect(reportedResetError()).toContain(`epoch ${forked.epoch} revision ${forked.revision}`);
        });

        it('leaves the marker when the replacement is durable under another root lineage', async () => {
            const marker = writeAbandonedReset();
            const forked = { ...replacementAuthority, rootLineage: 'lineage-forked' };
            durableAuthority(forked);

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-unavailable');
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 5, current, session: null, reset: marker });
            expect(booted.store.value).toEqual(current);
            expect(reportedResetError()).toContain(`epoch ${forked.epoch} revision ${forked.revision}`);
        });

        it('leaves the marker when the durable authority belongs to a third epoch', async () => {
            const marker = writeAbandonedReset();
            const foreign = { epoch: 'epoch-foreign', revision: 9, rootLineage: 'main' };
            durableAuthority(foreign);

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-unavailable');
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 5, current, session: null, reset: marker });
            expect(booted.store.value).toEqual(current);
            expect(reportedResetError()).toContain(`epoch ${foreign.epoch} revision ${foreign.revision}`);
        });

        it('leaves the marker when the durable authority cannot be read', async () => {
            const marker = writeAbandonedReset();
            mocks.loadPersistenceSnapshotFromIdb.mockRejectedValue(new Error('IDB transaction failed'));

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('reset-unavailable');
            expect(readStoredEnvelope()).toEqual({ version: 1, revision: 5, current, session: null, reset: marker });
            expect(booted.store.value).toEqual(current);
            expect(mocks.loggerError).toHaveBeenCalled();
        });

        it('defers to the instance that settled the reset while the authority was being read', async () => {
            writeAbandonedReset();
            const settledElsewhere = branchList(hotfix);
            mocks.loadPersistenceSnapshotFromIdb.mockImplementation(async () => {
                writeStoredEnvelope({
                    version: 1,
                    revision: 6,
                    current: settledElsewhere,
                    session: null,
                    reset: null,
                });
                return { authority: outgoingAuthority, bundle: null };
            });

            const booted = await bootBranchStateInstance();

            expect(booted.outcome).toBe('settled');
            expect(readStoredEnvelope()).toEqual({
                version: 1,
                revision: 6,
                current: settledElsewhere,
                session: null,
                reset: null,
            });
            expect(booted.store.value).toEqual(settledElsewhere);
        });
    });

    function storedReset(owner: string, previous: BranchStoreState, intended: BranchStoreState): StoredResetRecord {
        return { owner, old: outgoingAuthority, target: replacementAuthority, previous, intended };
    }

    function durableAuthority(authority: StoredPersistenceAuthority): void {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({ authority, bundle: null });
    }

    /** The message of the error a boot reported about an unclassifiable reset. */
    function reportedResetError(): string {
        const [reported] = mocks.loggerError.mock.calls.at(-1) ?? [];
        if (!(reported instanceof Error)) {
            throw new Error('No reset recovery error was reported');
        }
        return reported.message;
    }

    async function beginReset(instance: BranchStateInstance, intended: BranchStoreState): Promise<{ owner: string }> {
        const begun = await instance.authority.beginReset({
            old: outgoingAuthority,
            target: replacementAuthority,
            intended,
        });
        if (begun.status !== 'begun') {
            throw new Error(`Expected a reset, got ${begun.reason}`);
        }
        return begun.handle;
    }

    async function bootAt(revision: number, current: BranchStoreState): Promise<BranchStateInstance> {
        writeStoredEnvelope({ version: 1, revision, current, session: null, reset: null });
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
