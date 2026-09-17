import { branchStore, createDefaultBranchStoreState, type BranchStoreState } from '../stores/branchStore';

import {
    branchStateEnvelopeStorage,
    type BranchSessionRecord,
    type BranchStateEnvelope,
} from './branchStateEnvelopeStorage';
import {
    BRANCH_SESSION_LOCK_PREFIX,
    BRANCH_STATE_TRANSACTION_LOCK_NAME,
    withBranchStateLock,
} from './withBranchStateLock';

/**
 * Why a durable branch write did not happen.
 *
 * - `conflict` — another writer committed since the caller read the revision.
 * - `session-active` — a collaboration session owns the list and this writer
 *   cannot prove the session is abandoned.
 * - `superseded` — the session this call belongs to no longer owns the list.
 * - `write-failed` — storage refused the write (full origin quota).
 * - `storage-unavailable` — storage refused the read.
 * - `lock-unavailable` — no Web Locks API, so no write can be sequenced.
 */
export type BranchStateRefusal =
    'conflict' | 'session-active' | 'superseded' | 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

/** Refusals every transaction can produce whatever it decided. */
type BranchStateTransactionRefusal = 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

export type BranchStateCommitResult<TRefusal extends BranchStateRefusal = BranchStateRefusal> =
    { status: 'committed'; revision: number } | { status: 'refused'; reason: TRefusal | BranchStateTransactionRefusal };

export type BranchStateBootOutcome =
    'settled' | 'restored' | 'foreign-session-live' | 'lock-unavailable' | 'storage-unavailable';

export type BranchSessionHandle = { owner: string };

export type BranchSessionBeginResult =
    { status: 'begun'; handle: BranchSessionHandle } | { status: 'refused'; reason: BranchStateRefusal };

export type BranchSessionEndOutcome =
    'restored' | 'superseded' | 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

type BranchStateDecision<TRefusal extends BranchStateRefusal> =
    { kind: 'write'; next: BranchStateEnvelope } | { kind: 'refuse'; reason: TRefusal } | { kind: 'noop' };

type SessionLifetimeHold = { status: 'held'; release: () => void } | { status: 'lock-unavailable' };

/**
 * How a hydration reaches `branchStore`.
 *
 * Every durable write takes a Web Lock, so a caller that started inside an
 * app action's storage transaction has lost that ambient scope by the time the
 * projection lands. An unattributed store write — together with the document
 * writes its subscribers make — reads as an outside writer to the very action
 * that asked for the branch write, and that revokes the action's own execution
 * authority. A caller holding a transaction captures it before its first await
 * and passes it in; everyone else projects directly.
 */
export type BranchStateProjectionScope = (project: () => void) => void;

const projectDirectly: BranchStateProjectionScope = (project) => project();

/** The revision of the last envelope hydrated into `branchStore`. */
let liveRevision = 0;
let bootSettled: Promise<BranchStateBootOutcome> | null = null;
let ownSession: { owner: string; release: () => void } | null = null;
/**
 * The session record a boot found in storage while its owning instance was
 * gone but its lifetime lock had not yet been observed free.
 *
 * Only an exact match — same owner, same base revision, same backup — licenses
 * this instance to supersede that session, so a session that has moved on since
 * the boot read keeps its protection.
 */
let capturedForeignSession: { owner: string; baseRevision: number; backup: BranchStoreState } | null = null;

function sessionLockName(owner: string): string {
    return `${BRANCH_SESSION_LOCK_PREFIX}${owner}`;
}

function hydrate(envelope: BranchStateEnvelope, project: BranchStateProjectionScope = projectDirectly): void {
    liveRevision = envelope.revision;
    project(() => branchStore.set(envelope.current));
}

/**
 * The envelope a first transaction starts from when nothing durable exists yet.
 *
 * Revision 0 and never written on its own: seeding on read would turn a boot
 * into a write and race every other instance doing the same. The first real
 * commit writes revision 1.
 */
function seedEnvelope(): BranchStateEnvelope {
    return {
        version: 1,
        revision: 0,
        current: branchStateEnvelopeStorage.readLegacySeed() ?? createDefaultBranchStoreState(),
        session: null,
    };
}

function advance(
    envelope: BranchStateEnvelope,
    next: { current: BranchStoreState; session: BranchStateEnvelope['session'] }
): BranchStateEnvelope {
    return { version: 1, revision: envelope.revision + 1, current: next.current, session: next.session };
}

function runTransaction<TRefusal extends BranchStateRefusal>(
    decide: (envelope: BranchStateEnvelope) => BranchStateDecision<TRefusal>,
    project: BranchStateProjectionScope
): BranchStateCommitResult<TRefusal> {
    let envelope: BranchStateEnvelope;
    try {
        envelope = branchStateEnvelopeStorage.read() ?? seedEnvelope();
    } catch {
        return { status: 'refused', reason: 'storage-unavailable' };
    }

    const decision = decide(envelope);
    if (decision.kind === 'refuse') {
        // The caller decided against a stale view, so leave it holding the
        // fresh one — a refusal it cannot see the cause of is a refusal it will
        // retry against the same stale revision forever.
        hydrate(envelope, project);
        return { status: 'refused', reason: decision.reason };
    }
    if (decision.kind === 'noop') {
        hydrate(envelope, project);
        return { status: 'committed', revision: envelope.revision };
    }
    if (decision.next.revision !== envelope.revision + 1) {
        throw new Error('Branch state transaction produced a non-successive revision');
    }

    try {
        branchStateEnvelopeStorage.write(decision.next);
    } catch {
        // Nothing hydrated: the memory projection must not advance past what is
        // durable, or the next writer's revision would describe a write that
        // never landed.
        return { status: 'refused', reason: 'write-failed' };
    }
    hydrate(decision.next, project);
    return { status: 'committed', revision: decision.next.revision };
}

async function transact<TRefusal extends BranchStateRefusal>(
    decide: (envelope: BranchStateEnvelope) => BranchStateDecision<TRefusal>,
    project: BranchStateProjectionScope = projectDirectly
): Promise<BranchStateCommitResult<TRefusal>> {
    const outcome = await withBranchStateLock({
        name: BRANCH_STATE_TRANSACTION_LOCK_NAME,
        run: async () => runTransaction(decide, project),
    });
    return outcome.status === 'lock-unavailable' ? { status: 'refused', reason: 'lock-unavailable' } : outcome.value;
}

function decideCommit(
    envelope: BranchStateEnvelope,
    expectedRevision: number,
    next: BranchStoreState
): { decision: BranchStateDecision<'conflict' | 'session-active'>; supersedes: boolean } {
    if (envelope.revision !== expectedRevision) {
        return { decision: { kind: 'refuse', reason: 'conflict' }, supersedes: false };
    }

    const session = envelope.session;
    if (session === null) {
        return {
            decision: { kind: 'write', next: advance(envelope, { current: next, session: null }) },
            supersedes: false,
        };
    }
    if (session.owner === ownSession?.owner) {
        return { decision: { kind: 'write', next: advance(envelope, { current: next, session }) }, supersedes: false };
    }

    // A session whose instance is gone must not keep the branch list hostage,
    // and a session that is still running must not lose it. The captured record
    // is the proof: a boot saw this exact session with its lifetime lock free,
    // and nothing has changed it since.
    const captured = capturedForeignSession;
    const abandoned =
        captured !== null &&
        session.owner === captured.owner &&
        session.baseRevision === captured.baseRevision &&
        JSON.stringify(session.backup) === JSON.stringify(captured.backup);
    if (!abandoned) {
        return { decision: { kind: 'refuse', reason: 'session-active' }, supersedes: false };
    }
    return { decision: { kind: 'write', next: advance(envelope, { current: next, session: null }) }, supersedes: true };
}

/**
 * Whether this instance can sequence a durable write at all.
 *
 * A boot with nothing to recover still has to answer this: without a lock
 * manager every later commit refuses, and the user needs to hear that at boot
 * rather than from the first branch operation that fails. Asked with
 * `ifAvailable` so it never waits on a live transaction — a refused grant still
 * proves a manager exists.
 */
async function settledOrUnsequenced(): Promise<'settled' | 'lock-unavailable'> {
    const sequencing = await withBranchStateLock({
        name: BRANCH_STATE_TRANSACTION_LOCK_NAME,
        ifAvailable: true,
        run: async () => undefined,
    });
    return sequencing.status === 'lock-unavailable' ? 'lock-unavailable' : 'settled';
}

async function recoverAbandonedSession(
    observed: BranchStateEnvelope,
    session: BranchSessionRecord
): Promise<BranchStateBootOutcome> {
    const outcome = await withBranchStateLock({
        name: sessionLockName(session.owner),
        ifAvailable: true,
        run: async (granted): Promise<BranchStateBootOutcome> => {
            if (!granted) {
                capturedForeignSession = {
                    owner: session.owner,
                    baseRevision: session.baseRevision,
                    backup: session.backup,
                };
                hydrate(observed);
                return 'foreign-session-live';
            }
            let restored = false;
            const result = await transact<never>((fresh) => {
                if (fresh.session?.owner !== session.owner || fresh.session.baseRevision !== session.baseRevision) {
                    // Another instance already restored or superseded this
                    // session. Its envelope is the truth; a second restore
                    // would replay the same backup over that decision.
                    return { kind: 'noop' };
                }
                restored = true;
                return { kind: 'write', next: advance(fresh, { current: fresh.session.backup, session: null }) };
            });
            if (result.status === 'refused') {
                // A refused write leaves the session record durable, so the
                // next boot retries it; both refusals are storage saying no.
                return result.reason === 'lock-unavailable' ? 'lock-unavailable' : 'storage-unavailable';
            }
            return restored ? 'restored' : 'settled';
        },
    });

    if (outcome.status === 'lock-unavailable') {
        hydrate(observed);
        return 'lock-unavailable';
    }
    return outcome.value;
}

async function settleBoot(): Promise<BranchStateBootOutcome> {
    let observed: BranchStateEnvelope | null;
    try {
        observed = branchStateEnvelopeStorage.read();
    } catch {
        return 'storage-unavailable';
    }
    if (observed === null) {
        // Nothing durable to recover: hold the seed and let the first commit
        // write revision 1.
        hydrate(seedEnvelope());
        return settledOrUnsequenced();
    }
    if (observed.session === null) {
        hydrate(observed);
        return settledOrUnsequenced();
    }
    return recoverAbandonedSession(observed, observed.session);
}

/** A promise that stays pending until `release` is called. */
function createReleasableHold(): { held: Promise<void>; release: () => void } {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { held, release };
}

function holdSessionLifetimeLock(owner: string): Promise<SessionLifetimeHold> {
    return new Promise<SessionLifetimeHold>((resolve) => {
        const { held, release } = createReleasableHold();
        const request = withBranchStateLock({
            name: sessionLockName(owner),
            run: async () => {
                resolve({ status: 'held', release });
                await held;
            },
        });
        void request.then(
            (outcome) => {
                if (outcome.status === 'lock-unavailable') {
                    resolve({ status: 'lock-unavailable' });
                }
            },
            () => resolve({ status: 'lock-unavailable' })
        );
    });
}

function releaseOwnSession(owner: string): void {
    if (ownSession?.owner !== owner) {
        return;
    }
    ownSession.release();
    ownSession = null;
}

async function beginSession(): Promise<BranchSessionBeginResult> {
    await branchStateAuthority.settleBoot();
    const owner = globalThis.crypto.randomUUID();
    // Lifetime lock before the transaction lock, always: the reverse order
    // would let a boot holding the lifetime lock wait on a transaction lock
    // held by a session that is waiting for the lifetime lock.
    const lifetime = await holdSessionLifetimeLock(owner);
    if (lifetime.status === 'lock-unavailable') {
        return { status: 'refused', reason: 'lock-unavailable' };
    }

    const result = await transact<'session-active'>((envelope) => {
        if (envelope.session !== null) {
            return { kind: 'refuse', reason: 'session-active' };
        }
        return {
            kind: 'write',
            next: advance(envelope, {
                current: envelope.current,
                session: {
                    owner,
                    backup: envelope.current,
                    baseRevision: envelope.revision + 1,
                    sequence: 0,
                },
            }),
        };
    });
    if (result.status === 'refused') {
        lifetime.release();
        return { status: 'refused', reason: result.reason };
    }

    ownSession = { owner, release: lifetime.release };
    return { status: 'begun', handle: { owner } };
}

async function projectSession(
    handle: BranchSessionHandle,
    state: BranchStoreState
): Promise<BranchStateCommitResult<'superseded'>> {
    await branchStateAuthority.settleBoot();
    return transact<'superseded'>((envelope) => {
        const session = envelope.session;
        if (session?.owner !== handle.owner) {
            return { kind: 'refuse', reason: 'superseded' };
        }
        return {
            kind: 'write',
            next: advance(envelope, { current: state, session: { ...session, sequence: session.sequence + 1 } }),
        };
    });
}

async function endSession(handle: BranchSessionHandle): Promise<BranchSessionEndOutcome> {
    await branchStateAuthority.settleBoot();
    const result = await transact<'superseded'>((envelope) => {
        const session = envelope.session;
        if (session?.owner !== handle.owner) {
            return { kind: 'refuse', reason: 'superseded' };
        }
        return { kind: 'write', next: advance(envelope, { current: session.backup, session: null }) };
    });

    if (result.status === 'committed') {
        releaseOwnSession(handle.owner);
        return 'restored';
    }
    if (result.reason === 'superseded') {
        releaseOwnSession(handle.owner);
        return 'superseded';
    }
    // The session record is still durable, so the lifetime lock stays held: a
    // retry has to be able to finish the restore, and a booting instance must
    // keep seeing this session as live until it does.
    return result.reason;
}

/**
 * The single writer of durable branch state.
 *
 * One exported object rather than loose functions because they share the
 * revision, the boot promise and the session holds; splitting them across files
 * would put that state behind accessors and let a caller act on half of it.
 */
export const branchStateAuthority = {
    /** The revision a writer must pass back as `expectedRevision`. */
    captureRevision(): number {
        return liveRevision;
    },

    /**
     * Bring `branchStore` to what durable storage says, synchronously and
     * without writing anything.
     *
     * The composition root needs a branch list before any reader runs, and the
     * recovery that can rewrite it needs a lock, which is asynchronous. So the
     * two are separate: this is the read, `settleBoot` is the recovery.
     */
    hydrateFromDurableState(): 'hydrated' | 'seeded' | 'storage-unavailable' {
        try {
            const envelope = branchStateEnvelopeStorage.read();
            if (envelope !== null) {
                hydrate(envelope);
                return 'hydrated';
            }
            hydrate(seedEnvelope());
            return 'seeded';
        } catch {
            return 'storage-unavailable';
        }
    },

    /** Idempotent: the boot recovery runs once per instance. */
    settleBoot(): Promise<BranchStateBootOutcome> {
        bootSettled ??= settleBoot();
        return bootSettled;
    },

    /** Resolves once the boot recovery has settled, however it settled. */
    whenSettled(): Promise<void> {
        return branchStateAuthority.settleBoot().then(
            () => undefined,
            () => undefined
        );
    },

    /**
     * Compare-and-swap the branch list against the revision the caller read.
     *
     * Waits for the boot recovery rather than refusing: an ordinary writer that
     * started before the recovery finished is early, not wrong.
     */
    async commit({
        expectedRevision,
        next,
        projectionScope,
    }: {
        expectedRevision: number;
        next: BranchStoreState;
        projectionScope?: BranchStateProjectionScope;
    }): Promise<BranchStateCommitResult<'conflict' | 'session-active'>> {
        await branchStateAuthority.settleBoot();
        let supersedes = false;
        const result = await transact<'conflict' | 'session-active'>((envelope) => {
            const commit = decideCommit(envelope, expectedRevision, next);
            supersedes = commit.supersedes;
            return commit.decision;
        }, projectionScope);
        if (supersedes && result.status === 'committed') {
            capturedForeignSession = null;
        }
        return result;
    },

    /** Take ownership of the durable list for one collaboration session. */
    beginSession,

    /**
     * Publish a session's projected list.
     *
     * Call order is already storage order: every projection awaits the same
     * settled boot promise and then queues on the one transaction lock, so a
     * later projection cannot overtake an earlier one and durably resurrect the
     * branch list the peer had already replaced.
     */
    projectSession,

    /** Put the pre-session list back and hand the durable list back to local writers. */
    endSession,
};
