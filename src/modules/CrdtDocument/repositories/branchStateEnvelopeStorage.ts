import { parse } from 'superjson';

import { type LocalStorageKey } from '#/infra/store/storage/LocalStorageKeys';

import { readBranchStoreStateRecord, type BranchStoreState } from '../stores/branchStore';

const BRANCH_STATE_STORAGE_KEY: LocalStorageKey = 'sourdaw-branch-state';
const LEGACY_BRANCH_STORAGE_KEY: LocalStorageKey = 'sourdaw-branches';

const BRANCH_STATE_ENVELOPE_VERSION = 1;

/**
 * The collaboration session that currently owns the durable branch list.
 *
 * `backup` is the list as it stood locally when the session began, and the
 * session end puts it back. `baseRevision` and `owner` together identify the
 * exact session record a booting instance observed, so a recovery can prove it
 * is restoring the session it saw rather than a later one that reused the slot.
 * `sequence` counts accepted projections, which is what makes a stale
 * projection distinguishable from the newest one.
 */
export type BranchSessionRecord = {
    owner: string;
    backup: BranchStoreState;
    baseRevision: number;
    sequence: number;
};

/**
 * One durable record for everything about branch state, written whole.
 *
 * The two-key predecessor (`sourdaw-branches` plus a retained session backup)
 * had no ordering between its halves, so a crashed instance could apply its
 * stale backup over a branch another instance had committed in the meantime.
 * `revision` gives every writer something to compare against, and one key
 * means a reader can never see half of a transition.
 */
export type BranchStateEnvelope = {
    version: typeof BRANCH_STATE_ENVELOPE_VERSION;
    revision: number;
    current: BranchStoreState;
    session: BranchSessionRecord | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readSessionRecord(value: unknown): BranchSessionRecord | null | 'invalid' {
    if (value === null) {
        return null;
    }
    if (!isRecord(value) || typeof value.owner !== 'string' || value.owner === '') {
        return 'invalid';
    }
    if (!isRevision(value.baseRevision) || !isRevision(value.sequence)) {
        return 'invalid';
    }
    const backup = readBranchStoreStateRecord(value.backup);
    if (backup === null) {
        return 'invalid';
    }
    return { owner: value.owner, backup, baseRevision: value.baseRevision, sequence: value.sequence };
}

function readEnvelope(value: unknown): BranchStateEnvelope | null {
    if (!isRecord(value) || value.version !== BRANCH_STATE_ENVELOPE_VERSION || !isRevision(value.revision)) {
        return null;
    }
    const current = readBranchStoreStateRecord(value.current);
    if (current === null) {
        return null;
    }
    const session = readSessionRecord(value.session);
    if (session === 'invalid') {
        return null;
    }
    return { version: BRANCH_STATE_ENVELOPE_VERSION, revision: value.revision, current, session };
}

function resolveLocalStorage(): Storage | null {
    return typeof window === 'undefined' ? null : window.localStorage;
}

/**
 * The durable edge for branch state: one key, plain JSON, never cached.
 *
 * Every read hits the backing store because the whole point of the revision is
 * to see what another instance of the app wrote; a cache would hide it. Plain
 * `JSON` rather than the superjson store adapter keeps the envelope readable by
 * any instance regardless of which build wrote it, and keeps `revision`
 * comparable without a decode step.
 */
export const branchStateEnvelopeStorage = {
    /** The validated envelope, or `null` when absent or unreadable. Propagates a refused read. */
    read(): BranchStateEnvelope | null {
        const storage = resolveLocalStorage();
        const raw = storage?.getItem(BRANCH_STATE_STORAGE_KEY) ?? null;
        if (raw === null) {
            return null;
        }
        try {
            return readEnvelope(JSON.parse(raw));
        } catch {
            return null;
        }
    },

    /** Propagates a refused write: a caller that cannot persist must not report that it did. */
    write(envelope: BranchStateEnvelope): void {
        const storage = resolveLocalStorage();
        if (storage === null) {
            throw new Error('Branch state cannot be persisted without local storage');
        }
        storage.setItem(BRANCH_STATE_STORAGE_KEY, JSON.stringify(envelope));
    },

    /**
     * The pre-envelope branch list, read once to seed the first envelope so an
     * existing project keeps its branches across the upgrade. Superjson because
     * that is what wrote it.
     */
    readLegacySeed(): BranchStoreState | null {
        const storage = resolveLocalStorage();
        const raw = storage?.getItem(LEGACY_BRANCH_STORAGE_KEY) ?? null;
        if (raw === null) {
            return null;
        }
        try {
            return readBranchStoreStateRecord(parse(raw));
        } catch {
            return null;
        }
    },
};
