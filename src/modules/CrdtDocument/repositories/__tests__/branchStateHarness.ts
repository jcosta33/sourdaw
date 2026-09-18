import { vi } from 'vitest';

import { createControlledLockManager, type ControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { MAIN_BRANCH_ID, type BranchRecord, type BranchStoreState } from '../../stores/branchStore';
import { type BranchStateBootOutcome } from '../branchStateAuthority';
import {
    BRANCH_RESET_LOCK_PREFIX,
    BRANCH_SESSION_LOCK_PREFIX,
    BRANCH_STATE_TRANSACTION_LOCK_NAME,
} from '../withBranchStateLock';

export const BRANCH_STATE_STORAGE_KEY = 'sourdaw-branch-state';
export const LEGACY_BRANCH_STORAGE_KEY = 'sourdaw-branches';

export { BRANCH_STATE_TRANSACTION_LOCK_NAME };

export function sessionLockName(owner: string): string {
    return `${BRANCH_SESSION_LOCK_PREFIX}${owner}`;
}

export function resetLockName(owner: string): string {
    return `${BRANCH_RESET_LOCK_PREFIX}${owner}`;
}

export const mainBranch: BranchRecord = {
    branchId: MAIN_BRANCH_ID,
    name: 'Main',
    rootDocId: DOC_PREFIX_ROOT,
    sourceBranchId: null,
    createdAt: 100,
    createdFromHeads: [],
    note: '',
};

export function forkedBranch(branchId: string, name: string): BranchRecord {
    return {
        branchId,
        name,
        rootDocId: `branch_${branchId}`,
        sourceBranchId: MAIN_BRANCH_ID,
        createdAt: 200,
        createdFromHeads: [],
        note: '',
    };
}

export function branchList(...branches: BranchRecord[]): BranchStoreState {
    return { branches: [mainBranch, ...branches], activeBranchId: MAIN_BRANCH_ID };
}

export type StoredSessionRecord = {
    owner: string;
    backup: BranchStoreState;
    baseRevision: number;
    sequence: number;
};

export type StoredPersistenceAuthority = {
    epoch: string;
    revision: number;
    rootLineage: string;
};

export type StoredResetRecord = {
    owner: string;
    old: StoredPersistenceAuthority;
    target: StoredPersistenceAuthority;
    previous: BranchStoreState;
    intended: BranchStoreState;
};

export type StoredEnvelope = {
    version: number;
    revision: number;
    current: BranchStoreState;
    session: StoredSessionRecord | null;
    reset: StoredResetRecord | null;
};

export function writeStoredEnvelope(envelope: StoredEnvelope): void {
    window.localStorage.setItem(BRANCH_STATE_STORAGE_KEY, JSON.stringify(envelope));
}

export function writeRawStoredEnvelope(raw: string): void {
    window.localStorage.setItem(BRANCH_STATE_STORAGE_KEY, raw);
}

export function readStoredEnvelope(): StoredEnvelope | null {
    const raw = window.localStorage.getItem(BRANCH_STATE_STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as StoredEnvelope);
}

/**
 * The lock manager every instance loaded from here resolves.
 *
 * One object shared across module graphs, because that is what makes two
 * "instances" contend: each graph gets its own `withBranchStateLock` closure and
 * its own module state, but they queue on the same names.
 */
let activeLockManager: ControlledLockManager | null = null;

export function installBranchStateLockManager(): ControlledLockManager {
    activeLockManager = createControlledLockManager();
    return activeLockManager;
}

/** Simulate a runtime without the Web Locks API. */
export function removeBranchStateLockManager(): void {
    activeLockManager = null;
}

export type BranchStateInstance = {
    authority: (typeof import('../branchStateAuthority'))['branchStateAuthority'];
    store: (typeof import('../../stores/branchStore'))['branchStore'];
};

/**
 * A fresh module graph over the same `localStorage` and the same lock manager —
 * a second browser tab, or the same tab after a reload.
 */
export async function loadBranchStateInstance(): Promise<BranchStateInstance> {
    vi.resetModules();
    // Imported after the reset, deliberately: the DI container's state is a
    // module too, so an override registered through the previous graph's
    // container would never be read by this one.
    const { injectDependencies } = await import('#/infra/di/testing/injectDependencies');
    const lockModule = await import('../withBranchStateLock');
    injectDependencies(lockModule.withBranchStateLock, {
        resolveLockManager: () => activeLockManager?.locks,
    });
    const authorityModule = await import('../branchStateAuthority');
    const storeModule = await import('../../stores/branchStore');
    return { authority: authorityModule.branchStateAuthority, store: storeModule.branchStore };
}

/** What `initBranchState` does: the synchronous read, then the boot recovery. */
export async function bootBranchStateInstance(): Promise<
    BranchStateInstance & { outcome: BranchStateBootOutcome; hydration: string }
> {
    const instance = await loadBranchStateInstance();
    const hydration = instance.authority.hydrateFromDurableState();
    const outcome = await instance.authority.settleBoot();
    return { ...instance, outcome, hydration };
}

/**
 * Blocked storage access and a full origin quota both surface as a throw from
 * `setItem` — `SecurityError` and `QuotaExceededError` respectively. Neither is
 * distinguishable at the storage edge, and both must be survivable.
 */
export function blockEveryDurableWrite(): () => void {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    return () => {
        blocked.mockRestore();
    };
}

/**
 * Hold a lock the way a live instance holds one: taken for as long as that
 * instance runs, released when it goes away. The grant is synchronous, so the
 * name is contended the moment this returns.
 */
export function holdBranchStateLock(manager: ControlledLockManager, name: string): () => void {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    void manager.locks.request(name, { mode: 'exclusive' }, async () => held);
    return release;
}

/**
 * Let a released lock actually leave the manager.
 *
 * Releasing a lock resolves the promise its grant callback awaits, so the
 * manager drops the name a few microtasks later. A probe issued in the same
 * tick as the release would read the lock as still held.
 */
export async function settleBranchStateLocks(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/** Whether `name` is free right now — the same question a boot asks about a session. */
export async function isBranchStateLockFree(manager: ControlledLockManager, name: string): Promise<boolean> {
    let free = false;
    await manager.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        free = lock !== null;
    });
    return free;
}

/**
 * The lifetime lock name an instance minted for its session. The owner is a
 * UUID the instance keeps to itself, so the only way to name that lock from a
 * test is to read what was requested.
 */
export function lastRequestedSessionLockName(manager: ControlledLockManager): string {
    const name = manager.requestedNames.findLast((requested) => requested.startsWith(BRANCH_SESSION_LOCK_PREFIX));
    if (name === undefined) {
        throw new Error('No session lifetime lock was requested');
    }
    return name;
}

/** The lifetime lock name an instance minted for its project reset. */
export function lastRequestedResetLockName(manager: ControlledLockManager): string {
    const name = manager.requestedNames.findLast((requested) => requested.startsWith(BRANCH_RESET_LOCK_PREFIX));
    if (name === undefined) {
        throw new Error('No reset lifetime lock was requested');
    }
    return name;
}

export function blockEveryDurableRead(): () => void {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access to storage is not allowed from this context.', 'SecurityError');
    });
    return () => {
        blocked.mockRestore();
    };
}
