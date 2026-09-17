import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BRANCH_STATE_TRANSACTION_LOCK_NAME,
    blockEveryDurableRead,
    blockEveryDurableWrite,
    bootBranchStateInstance,
    branchList,
    forkedBranch,
    holdBranchStateLock,
    installBranchStateLockManager,
    LEGACY_BRANCH_STORAGE_KEY,
    loadBranchStateInstance,
    mainBranch,
    readStoredEnvelope,
    removeBranchStateLockManager,
    sessionLockName,
    writeRawStoredEnvelope,
    writeStoredEnvelope,
} from '../../repositories/__tests__/branchStateHarness';
import { MAIN_BRANCH_ID } from '../branchStore';

const feature = forkedBranch('feature', 'Feature');

/**
 * Boot is the half of the branch-state protocol that runs before anything else
 * can read a branch id, and the half that decides the fate of a collaboration
 * session whose instance never came back. Each case is one storage state plus
 * one answer from that session's lifetime lock.
 */
describe('branch state boot', () => {
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

    it('seeds the legacy branch list into memory without writing anything', async () => {
        const legacy = branchList(feature);
        window.localStorage.setItem(LEGACY_BRANCH_STORAGE_KEY, stringify(legacy));

        const instance = await bootBranchStateInstance();

        expect(instance.store.value).toEqual(legacy);
        expect(readStoredEnvelope()).toBeNull();
        expect(instance.authority.captureRevision()).toBe(0);

        const committed = await instance.authority.commit({ expectedRevision: 0, next: legacy });

        expect(committed).toEqual({ status: 'committed', revision: 1 });
        expect(readStoredEnvelope()).toEqual({ version: 1, revision: 1, current: legacy, session: null });
    });

    it('starts on the default main list when nothing durable exists', async () => {
        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('settled');
        expect(instance.store.value?.branches).toEqual([expect.objectContaining({ branchId: MAIN_BRANCH_ID })]);
        expect(readStoredEnvelope()).toBeNull();
    });

    it('adopts an envelope with no session without writing to it', async () => {
        const current = branchList(feature);
        writeStoredEnvelope({ version: 1, revision: 5, current, session: null });

        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('settled');
        expect(instance.store.value).toEqual(current);
        expect(instance.authority.captureRevision()).toBe(5);
        expect(readStoredEnvelope()?.revision).toBe(5);
    });

    it('restores the backup of a session whose instance is gone', async () => {
        const backup = branchList();
        writeStoredEnvelope({
            version: 1,
            revision: 7,
            current: branchList(feature),
            session: { owner: 'o1', backup, baseRevision: 6, sequence: 1 },
        });

        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('restored');
        expect(readStoredEnvelope()).toEqual({ version: 1, revision: 8, current: backup, session: null });
        expect(instance.store.value).toEqual(backup);
        expect(manager.requestedNames).toContain(sessionLockName('o1'));
    });

    it('leaves a session whose instance is still running untouched', async () => {
        const current = branchList(feature);
        writeStoredEnvelope({
            version: 1,
            revision: 7,
            current,
            session: { owner: 'o1', backup: branchList(), baseRevision: 6, sequence: 1 },
        });
        // The session's own instance, still running: it holds the lifetime lock
        // for as long as the session lives.
        const releaseLifetime = holdBranchStateLock(manager, sessionLockName('o1'));

        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('foreign-session-live');
        expect(instance.store.value).toEqual(current);
        expect(readStoredEnvelope()).toEqual({
            version: 1,
            revision: 7,
            current,
            session: { owner: 'o1', backup: branchList(), baseRevision: 6, sequence: 1 },
        });
        releaseLifetime();
    });

    it('does not restore a second time when another instance already restored', async () => {
        const backup = branchList();
        writeStoredEnvelope({
            version: 1,
            revision: 7,
            current: branchList(feature),
            session: { owner: 'o1', backup, baseRevision: 6, sequence: 1 },
        });
        // Held so this boot's recovery transaction waits, which is where the
        // other instance's restore lands.
        const releaseTransaction = holdBranchStateLock(manager, BRANCH_STATE_TRANSACTION_LOCK_NAME);

        const late = await loadBranchStateInstance();
        late.authority.hydrateFromDurableState();
        const settling = late.authority.settleBoot();

        writeStoredEnvelope({ version: 1, revision: 8, current: backup, session: null });
        releaseTransaction();

        await expect(settling).resolves.toBe('settled');
        expect(readStoredEnvelope()?.revision).toBe(8);
        expect(late.store.value).toEqual(backup);
        expect(late.authority.captureRevision()).toBe(8);
    });

    it('reports an unsequenceable boot when the Web Locks API is absent', async () => {
        const current = branchList(feature);
        writeStoredEnvelope({ version: 1, revision: 5, current, session: null });
        removeBranchStateLockManager();

        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('lock-unavailable');
        expect(instance.store.value).toEqual(current);

        const refused = await instance.authority.commit({ expectedRevision: 5, next: branchList() });

        expect(refused).toEqual({ status: 'refused', reason: 'lock-unavailable' });
        expect(readStoredEnvelope()?.revision).toBe(5);
    });

    it('starts on the default main list when the envelope is not readable JSON', async () => {
        writeRawStoredEnvelope('{not-json');

        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('settled');
        expect(instance.store.value?.branches).toEqual([expect.objectContaining({ branchId: MAIN_BRANCH_ID })]);

        const committed = await instance.authority.commit({ expectedRevision: 0, next: branchList(feature) });

        expect(committed).toEqual({ status: 'committed', revision: 1 });
    });

    it('keeps the session record when the origin quota refuses the restore', async () => {
        const session = { owner: 'o1', backup: branchList(), baseRevision: 6, sequence: 1 };
        const current = branchList(feature);
        writeStoredEnvelope({ version: 1, revision: 7, current, session });
        const restoreWrites = blockEveryDurableWrite();

        const instance = await bootBranchStateInstance();

        expect(instance.outcome).toBe('storage-unavailable');
        restoreWrites();
        // The session record survives a refused restore, so the next boot
        // retries it rather than losing the pre-session list.
        expect(readStoredEnvelope()).toEqual({ version: 1, revision: 7, current, session });
    });

    it('reports a refused read instead of starting a recovery it cannot see', async () => {
        writeStoredEnvelope({ version: 1, revision: 5, current: branchList(feature), session: null });
        const restoreReads = blockEveryDurableRead();

        const instance = await bootBranchStateInstance();

        expect(instance.hydration).toBe('storage-unavailable');
        expect(instance.outcome).toBe('storage-unavailable');
        restoreReads();
        expect(readStoredEnvelope()?.revision).toBe(5);
        // Nothing was hydrated, so the default list stands and no writer can
        // claim to have observed revision 5.
        expect(instance.store.value?.branches).toEqual([expect.objectContaining({ branchId: mainBranch.branchId })]);
    });
});
