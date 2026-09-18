import { logger } from '#/infra/logger/appLogger';
import { canonicalJson } from '#/utils/canonicalDigest';

import { branchStore, createDefaultBranchStoreState, type BranchStoreState } from '../stores/branchStore';

import {
    branchStateEnvelopeStorage,
    type BranchResetRecord,
    type BranchSessionRecord,
    type BranchStateEnvelope,
} from './branchStateEnvelopeStorage';
import { arePersistenceAuthoritiesEqual } from './crdtPersistence/arePersistenceAuthoritiesEqual';
import { loadPersistenceSnapshotFromIdb } from './crdtPersistence/loadPersistenceSnapshotFromIdb';
import {
    EMPTY_PERSISTENCE_AUTHORITY,
    type CrdtPersistenceAuthority,
} from './crdtPersistence/persistenceAuthorityModel';
import {
    BRANCH_RESET_LOCK_PREFIX,
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
 * - `reset-active` — a project reset already owns the envelope.
 * - `reset-pending` — a project reset owns the envelope, and only the reset's
 *   own begin/finalize pair may write while it does.
 * - `superseded` — the session this call belongs to no longer owns the list.
 * - `write-failed` — storage refused the write (full origin quota).
 * - `storage-unavailable` — storage refused the read.
 * - `lock-unavailable` — no Web Locks API, so no write can be sequenced.
 */
export type BranchStateRefusal =
    | 'conflict'
    | 'session-active'
    | 'reset-active'
    | 'reset-pending'
    | 'superseded'
    | 'write-failed'
    | 'storage-unavailable'
    | 'lock-unavailable';

/** Refusals every transaction can produce whatever it decided. */
type BranchStateTransactionRefusal = 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

export type BranchStateCommitResult<TRefusal extends BranchStateRefusal = BranchStateRefusal> =
    { status: 'committed'; revision: number } | { status: 'refused'; reason: TRefusal | BranchStateTransactionRefusal };

/**
 * How a boot classified what it found.
 *
 * The four `reset-*` outcomes answer the one question a reset marker poses:
 * `reset-live` another instance is still performing it; `reset-rolled-back` the
 * replacement never reached storage and the previous list is back;
 * `reset-finalized` it did and the new list is published; `reset-unavailable`
 * the durable authority answers neither, so the marker stays for a later boot.
 */
export type BranchStateBootOutcome =
    | 'settled'
    | 'restored'
    | 'foreign-session-live'
    | 'reset-live'
    | 'reset-rolled-back'
    | 'reset-finalized'
    | 'reset-unavailable'
    | 'lock-unavailable'
    | 'storage-unavailable';

export type BranchSessionHandle = { owner: string };

export type BranchSessionBeginResult =
    { status: 'begun'; handle: BranchSessionHandle } | { status: 'refused'; reason: BranchStateRefusal };

export type BranchSessionEndOutcome =
    'restored' | 'superseded' | 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

export type BranchResetHandle = { owner: string };

export type BranchResetRefusal =
    'session-active' | 'reset-active' | 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

export type BranchResetBeginResult =
    { status: 'begun'; handle: BranchResetHandle } | { status: 'refused'; reason: BranchResetRefusal };

export type BranchResetFinalizeOutcome =
    'finalized' | 'authority-mismatch' | 'superseded' | 'write-failed' | 'storage-unavailable' | 'lock-unavailable';

type BranchStateDecision<TRefusal extends BranchStateRefusal> =
    { kind: 'write'; next: BranchStateEnvelope } | { kind: 'refuse'; reason: TRefusal } | { kind: 'noop' };

type LifetimeHold = { status: 'held'; release: () => void } | { status: 'lock-unavailable' };

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
/**
 * The reset this instance began and has not finalized, with the hold on its
 * lifetime lock. The lock is what tells a booting instance that the reset is
 * still being performed rather than abandoned, so it is released only once the
 * marker has left the envelope.
 */
let ownReset: {
    owner: string;
    target: CrdtPersistenceAuthority;
    intended: BranchStoreState;
    release: () => void;
} | null = null;

function sessionLockName(owner: string): string {
    return `${BRANCH_SESSION_LOCK_PREFIX}${owner}`;
}

function resetLockName(owner: string): string {
    return `${BRANCH_RESET_LOCK_PREFIX}${owner}`;
}

/**
 * Project a durable envelope into memory.
 *
 * While this instance's own reset is pending, `current` is still the outgoing
 * project's list and the intended one is what the reset already published, so
 * the marker's `intended` is projected instead: hydrating `current` would put
 * the replaced project's branches over the replacement's root, and every later
 * branch action would write them there.
 */
function hydrate(envelope: BranchStateEnvelope, project: BranchStateProjectionScope = projectDirectly): void {
    liveRevision = envelope.revision;
    const own = ownReset;
    const current = own !== null && envelope.reset?.owner === own.owner ? own.intended : envelope.current;
    project(() => branchStore.set(current));
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
        reset: null,
    };
}

function advance(
    envelope: BranchStateEnvelope,
    next: {
        current: BranchStoreState;
        session: BranchStateEnvelope['session'];
        reset?: BranchStateEnvelope['reset'];
    }
): BranchStateEnvelope {
    return {
        version: 1,
        revision: envelope.revision + 1,
        current: next.current,
        session: next.session,
        reset: next.reset ?? null,
    };
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
): { decision: BranchStateDecision<'conflict' | 'session-active' | 'reset-pending'>; supersedes: boolean } {
    if (envelope.reset !== null) {
        // A reset in progress owns the envelope: the list it publishes is
        // decided by whether its replacement bundle commits, and an ordinary
        // write landing in between would be rolled back or finalized away
        // without its author ever learning that it was.
        return { decision: { kind: 'refuse', reason: 'reset-pending' }, supersedes: false };
    }
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

function describeAuthority({ epoch, revision, rootLineage }: CrdtPersistenceAuthority): string {
    return `epoch ${epoch === '' ? '(none)' : epoch} revision ${revision} lineage ${rootLineage}`;
}

/**
 * Whether the marker still in the envelope is the one this boot classified.
 *
 * Owner, `old` and `target` together: an owner alone would let a restarted
 * instance's second reset be settled by the first one's durable reading.
 */
function isSameResetRecord(fresh: BranchResetRecord | null, observed: BranchResetRecord): boolean {
    return (
        fresh !== null &&
        fresh.owner === observed.owner &&
        arePersistenceAuthoritiesEqual(fresh.old, observed.old) &&
        arePersistenceAuthoritiesEqual(fresh.target, observed.target)
    );
}

/**
 * Whether one authority is the project the other names.
 *
 * The epoch names the side: a reset mints a fresh epoch for the project it is
 * writing, so the target epoch is the replacement and the old epoch is the
 * project being replaced. The root lineage then proves the branch list this
 * marker carries still describes the durable root — a fork landing a new
 * lineage under the same epoch moved the project to a root that list does not
 * name. The revision is free: it only counts ordinary saves, and a save does
 * not change which project is durable.
 */
function isSameResetSide(durable: CrdtPersistenceAuthority, side: CrdtPersistenceAuthority): boolean {
    return durable.epoch === side.epoch && durable.rootLineage === side.rootLineage;
}

/**
 * Which side of the replacement the durable persistence authority proves.
 *
 * `null` when it proves neither, so no branch list this marker carries
 * describes the durable project and only a later boot can settle the reset.
 */
function getResetSettlement(
    reset: BranchResetRecord,
    durable: CrdtPersistenceAuthority
): { current: BranchStoreState; outcome: 'reset-rolled-back' | 'reset-finalized' } | null {
    if (isSameResetSide(durable, reset.old)) {
        return { current: reset.previous, outcome: 'reset-rolled-back' };
    }
    if (isSameResetSide(durable, reset.target)) {
        return { current: reset.intended, outcome: 'reset-finalized' };
    }
    return null;
}

/** `null` when the marker changed underneath, so the caller classifies again. */
async function resolveAbandonedReset(
    observed: BranchStateEnvelope,
    reset: BranchResetRecord
): Promise<BranchStateBootOutcome | null> {
    let durable: CrdtPersistenceAuthority;
    try {
        const snapshot = await loadPersistenceSnapshotFromIdb();
        durable = snapshot?.authority ?? EMPTY_PERSISTENCE_AUTHORITY;
    } catch (error) {
        hydrate(observed);
        logger.error(
            new Error('Project reset recovery could not read the durable persistence authority', { cause: error })
        );
        return 'reset-unavailable';
    }

    const settlement = getResetSettlement(reset, durable);
    if (settlement === null) {
        hydrate(observed);
        logger.error(
            new Error(
                `Project reset recovery found a durable persistence authority matching neither side of the reset: ` +
                    `durable is ${describeAuthority(durable)}, the reset left ${describeAuthority(reset.old)} and ` +
                    `was writing ${describeAuthority(reset.target)}. The reset marker is left for a later boot.`
            )
        );
        return 'reset-unavailable';
    }

    let settled = false;
    const result = await transact<never>((fresh) => {
        if (!isSameResetRecord(fresh.reset, reset)) {
            // Another instance settled this reset while the authority was being
            // read. Its envelope is the truth; writing here would replay a
            // decision that instance has already made.
            return { kind: 'noop' };
        }
        settled = true;
        return { kind: 'write', next: advance(fresh, { current: settlement.current, session: null }) };
    });
    if (result.status === 'refused') {
        // The marker stays durable, so the next boot retries the same
        // classification; both refusals are storage saying no.
        return result.reason === 'lock-unavailable' ? 'lock-unavailable' : 'storage-unavailable';
    }
    return settled ? settlement.outcome : null;
}

/**
 * Classify a reset marker while holding its lifetime lock.
 *
 * The lock is taken with `ifAvailable` and held across the durable read and the
 * swap, so the instance that owns the reset cannot restart and begin a second
 * one in the middle of this decision. Lifetime lock first, transaction lock
 * inside it — the same order every other caller uses.
 */
async function classifyAbandonedReset(
    observed: BranchStateEnvelope,
    reset: BranchResetRecord
): Promise<BranchStateBootOutcome | null> {
    const outcome = await withBranchStateLock({
        name: resetLockName(reset.owner),
        ifAvailable: true,
        run: async (granted): Promise<BranchStateBootOutcome | null> => {
            if (!granted) {
                // The instance performing the reset is still alive, and only it
                // knows whether its replacement bundle is going to commit.
                hydrate(observed);
                return 'reset-live';
            }
            return resolveAbandonedReset(observed, reset);
        },
    });

    if (outcome.status === 'lock-unavailable') {
        hydrate(observed);
        return 'lock-unavailable';
    }
    return outcome.value;
}

type ObservedEnvelope = { status: 'read'; envelope: BranchStateEnvelope | null } | { status: 'storage-unavailable' };

function observeEnvelope(): ObservedEnvelope {
    try {
        return { status: 'read', envelope: branchStateEnvelopeStorage.read() };
    } catch {
        return { status: 'storage-unavailable' };
    }
}

/**
 * A marker that changed between the durable read and the swap belongs to an
 * instance that settled the reset first, so one re-read is enough to see its envelope. A
 * second inconclusive pass is left to a later boot rather than spun on.
 */
const RESET_CLASSIFICATION_ATTEMPTS = 2;

async function settleBoot(): Promise<BranchStateBootOutcome> {
    let observed = observeEnvelope();
    for (let attempt = 0; attempt < RESET_CLASSIFICATION_ATTEMPTS; attempt++) {
        if (observed.status === 'storage-unavailable') {
            return 'storage-unavailable';
        }
        if (observed.envelope === null || observed.envelope.reset === null) {
            break;
        }
        const outcome = await classifyAbandonedReset(observed.envelope, observed.envelope.reset);
        if (outcome !== null) {
            return outcome;
        }
        observed = observeEnvelope();
    }

    if (observed.status === 'storage-unavailable') {
        return 'storage-unavailable';
    }
    if (observed.envelope !== null && observed.envelope.reset !== null) {
        // Every pass saw a fresh marker the owner kept superseding: it stays, project pending.
        return 'reset-unavailable';
    }
    // Nothing durable to recover means the seed; an envelope without a session settles as-is.
    if (observed.envelope === null || observed.envelope.session === null) {
        hydrate(observed.envelope ?? seedEnvelope());
        return settledOrUnsequenced();
    }
    return recoverAbandonedSession(observed.envelope, observed.envelope.session);
}

/** A promise that stays pending until `release` is called. */
function createReleasableHold(): { held: Promise<void>; release: () => void } {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { held, release };
}

/** Take `name` and keep it until the returned `release` is called. */
function holdLifetimeLock(name: string): Promise<LifetimeHold> {
    return new Promise<LifetimeHold>((resolve) => {
        const { held, release } = createReleasableHold();
        const request = withBranchStateLock({
            name,
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
    const lifetime = await holdLifetimeLock(sessionLockName(owner));
    if (lifetime.status === 'lock-unavailable') {
        return { status: 'refused', reason: 'lock-unavailable' };
    }

    const result = await transact<'session-active' | 'reset-pending'>((envelope) => {
        if (envelope.reset !== null) {
            return { kind: 'refuse', reason: 'reset-pending' };
        }
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
): Promise<BranchStateCommitResult<'superseded' | 'reset-pending'>> {
    await branchStateAuthority.settleBoot();
    return transact<'superseded' | 'reset-pending'>((envelope) => {
        if (envelope.reset !== null) {
            return { kind: 'refuse', reason: 'reset-pending' };
        }
        const session = envelope.session;
        if (session?.owner !== handle.owner) {
            return { kind: 'refuse', reason: 'superseded' };
        }
        if (canonicalJson(state) === canonicalJson(envelope.current)) {
            // Canonical rather than `JSON.stringify`: the document materialises
            // branch records with a different key order than the store, so the
            // list already durable would compare unequal and be written again.
            return { kind: 'noop' };
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

function releaseOwnReset(owner: string): void {
    if (ownReset?.owner !== owner) {
        return;
    }
    ownReset.release();
    ownReset = null;
}

/**
 * Record a project reset durably before the outgoing root is destroyed.
 *
 * `old` is the persistence authority the replacement compare-and-swaps against
 * and `target` the one it writes, so the marker alone tells a later boot which
 * project the durable bundle belongs to. `intended` is the list to publish once
 * `target` is durable — passed in rather than derived here because the caller's
 * default list carries a creation timestamp, and a second call to the factory
 * would publish a list the caller never saw.
 *
 * A marker this instance owns does not block a second reset: nothing
 * re-classifies it while the session runs, so refusing would wedge every later
 * New Project until a reload. It is settled here against the fresh durable
 * authority the caller read, and the new marker inherits the list that rollback
 * has to restore — the abandoned reset's `previous` when the outgoing project is
 * still durable, its `intended` when the replacement reached storage. A marker
 * another instance owns still refuses: only its own holder can settle it.
 */
async function beginReset({
    old,
    target,
    intended,
}: {
    old: CrdtPersistenceAuthority;
    target: CrdtPersistenceAuthority;
    intended: BranchStoreState;
}): Promise<BranchResetBeginResult> {
    await branchStateAuthority.settleBoot();
    const owner = globalThis.crypto.randomUUID();
    // Lifetime lock before the transaction lock, as every other lifetime holder
    // does: a boot holding this lock waits on the transaction lock inside it.
    const lifetime = await holdLifetimeLock(resetLockName(owner));
    if (lifetime.status === 'lock-unavailable') {
        return { status: 'refused', reason: 'lock-unavailable' };
    }

    const result = await transact<'session-active' | 'reset-active'>((envelope) => {
        if (envelope.session !== null) {
            // A collaboration session owns the list, and the backup it holds
            // describes the project this reset is about to destroy.
            return { kind: 'refuse', reason: 'session-active' };
        }
        const superseded = envelope.reset;
        if (superseded === null) {
            return {
                kind: 'write',
                next: advance(envelope, {
                    current: envelope.current,
                    session: null,
                    reset: { owner, old, target, previous: envelope.current, intended },
                }),
            };
        }
        if (superseded.owner !== ownReset?.owner) {
            return { kind: 'refuse', reason: 'reset-active' };
        }
        const settlement = getResetSettlement(superseded, old);
        if (settlement === null) {
            // The durable authority names neither side of the abandoned reset,
            // so no list it carries describes the durable project and only a
            // boot can say what it left.
            return { kind: 'refuse', reason: 'reset-active' };
        }
        // Both lists are the settlement's: `current` describes the project the
        // durable authority proves is on disk, and that same list is what a
        // rollback of this new reset has to restore. The envelope's own
        // `current` was frozen when the abandoned reset began, so keeping it
        // would republish the project that reset already replaced.
        return {
            kind: 'write',
            next: advance(envelope, {
                current: settlement.current,
                session: null,
                reset: { owner, old, target, previous: settlement.current, intended },
            }),
        };
    });
    if (result.status === 'refused') {
        lifetime.release();
        return { status: 'refused', reason: result.reason };
    }

    // The superseded marker has left the envelope, so its lifetime lock no
    // longer describes anything a booting instance has to wait for. Its handle
    // answers `superseded` from here on, as a foreign supersession does.
    ownReset?.release();
    ownReset = { owner, target, intended, release: lifetime.release };
    return { status: 'begun', handle: { owner } };
}

/**
 * Publish the replacement's branch list and clear the marker.
 *
 * `committed` is the authority the replacement actually reached storage with.
 * It counts when it names this reset's target side: the epoch this reset minted
 * for the project it is writing, under the root lineage the intended branch list
 * describes. The revision is free — an incremental save landing between the
 * snapshot and this call advances it without changing which project is durable.
 *
 * The comparison is against the target from memory, before any transaction: the
 * envelope's `current` is still the replaced project's list, so a refusing
 * transaction would hydrate it back over the list the reset already projected —
 * the precise defect a durable marker exists to prevent.
 */
async function finalizeReset(
    handle: BranchResetHandle,
    committed: CrdtPersistenceAuthority | null
): Promise<BranchResetFinalizeOutcome> {
    const own = ownReset;
    if (own?.owner !== handle.owner) {
        return 'superseded';
    }
    if (committed === null || !isSameResetSide(committed, own.target)) {
        // The marker stays durable: a boot reading the authority is the only
        // thing that can say which project this half-finished reset left.
        return 'authority-mismatch';
    }

    const result = await transact<'superseded'>((envelope) => {
        const reset = envelope.reset;
        if (reset?.owner !== handle.owner) {
            return { kind: 'refuse', reason: 'superseded' };
        }
        return { kind: 'write', next: advance(envelope, { current: reset.intended, session: null }) };
    });

    if (result.status === 'committed') {
        releaseOwnReset(handle.owner);
        return 'finalized';
    }
    if (result.reason === 'superseded') {
        releaseOwnReset(handle.owner);
        return 'superseded';
    }
    // The marker is still durable, so the lifetime lock stays held: a booting
    // instance must keep seeing this reset as live until it clears.
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
    }): Promise<BranchStateCommitResult<'conflict' | 'session-active' | 'reset-pending'>> {
        await branchStateAuthority.settleBoot();
        let supersedes = false;
        const result = await transact<'conflict' | 'session-active' | 'reset-pending'>((envelope) => {
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
     * branch list the peer had already replaced. A projection of the list that
     * is already durable commits at the unchanged revision: an echo of the
     * session's own local write must not advance the revision a following local
     * transition has already captured.
     */
    projectSession,

    /** Put the pre-session list back and hand the durable list back to local writers. */
    endSession,

    /** Record a project reset durably before the outgoing root is destroyed. */
    beginReset,

    /** Publish the replacement's branch list once its bundle is durable. */
    finalizeReset,
};
