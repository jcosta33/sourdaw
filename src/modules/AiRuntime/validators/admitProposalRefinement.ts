import { canonicalJson } from '#/utils/canonicalDigest';

import { type ProjectContext } from '../models/ProjectContext';
import { type ThreadContext } from '../models/ThreadContext';

type ProposalRefinementAdmission =
    { status: 'none' } | { status: 'refines'; confirmationId: string } | { status: 'refused'; reason: string };

const NO_PENDING_PROPOSAL_REASON =
    'refines names a pending proposal, but this request has no pending proposal in thread_context to refine; propose without refines.';
const OTHER_PROPOSAL_REASON =
    'refines must be the confirmation id of the pending proposal in thread_context; leave it out for a request that does not refine that proposal.';
const SCHEDULED_PROPOSAL_REASON =
    'The pending proposal is one batch of a multi-batch schedule, and replacing it would drop the batches after it; propose without refines.';

/**
 * Whether a proposal's `refines` binds it to the pending proposal of the thread it was planned in.
 * It must name that proposal's confirmation id exactly; a request from outside a thread, or with
 * nothing pending, has nothing to refine, and a batch of a multi-batch schedule cannot be replaced
 * without dropping the batches still owed after it.
 */
export function admitProposalRefinement(
    refines: unknown,
    thread: ThreadContext | null | undefined
): ProposalRefinementAdmission {
    // Only an absent `refines` is no refinement. The tool loop drops a strict reply's `refines: null`
    // before the planner reads it, so null never arrives here; any other value names a card and is
    // checked as one, so one that did arrive would be refused rather than read as none.
    if (refines === undefined) {
        return { status: 'none' };
    }
    const pending = thread?.pendingProposal ?? null;
    if (pending === null) {
        return { status: 'refused', reason: NO_PENDING_PROPOSAL_REASON };
    }
    if (refines !== pending.confirmationId) {
        return { status: 'refused', reason: OTHER_PROPOSAL_REASON };
    }
    if (pending.batchPosition !== null) {
        return { status: 'refused', reason: SCHEDULED_PROPOSAL_REASON };
    }
    return { status: 'refines', confirmationId: pending.confirmationId };
}

type Command = { type: string; payload?: unknown };

/**
 * What a creating command creates, read from the action registry by the caller: the id fields the
 * application minted for the new object, and the names its provider arguments give it. `null` when
 * the command creates nothing.
 */
export type ReadCreatedObject = (
    actionType: string,
    payload: Readonly<Record<string, unknown>>,
    context: ProjectContext
) => { idFields: readonly string[]; names: readonly string[] } | null;

/**
 * What a request asks of one command of the stored card it refines, read by the refinement reader the
 * caller supplies, so a stored card and a card with a grounding basis are read by one removal reading:
 * the request removes it, keeps it, or removes a creation it cannot tell from another.
 */
export type ReadCommandRemoval = (input: {
    prompt: string;
    command: Command;
    pendingActions: readonly Command[];
    context: ProjectContext;
}) => { status: 'removes' } | { status: 'keeps' } | { status: 'ambiguous'; reason: string };

type CreatedObjectOf = (command: Command) => ReturnType<ReadCreatedObject>;

function payloadOf(command: Command): Record<string, unknown> {
    if (typeof command.payload === 'object' && command.payload !== null && !Array.isArray(command.payload)) {
        return command.payload as Record<string, unknown>;
    }
    return {};
}

function readsCreatedObjects(createdObject: ReadCreatedObject, context: ProjectContext): CreatedObjectOf {
    return (command) => createdObject(command.type, payloadOf(command), context);
}

/** The object ids a command's payload states, without the ids the application minted for what it creates. */
function statedIdEntries(command: Command, createdObjectOf: CreatedObjectOf): Array<[string, string]> {
    const minted = new Set(createdObjectOf(command)?.idFields ?? []);
    const entries: Array<[string, string]> = [];
    for (const [field, value] of Object.entries(payloadOf(command))) {
        if (field.endsWith('Id') && !field.startsWith('expected') && typeof value === 'string' && !minted.has(field)) {
            entries.push([field, value]);
        }
    }
    return entries;
}

/**
 * What a stored command creates, if anything, and the object ids it acts on, without the ids the
 * application minted for what it creates.
 */
export function readStoredCommandObjects(
    command: Command,
    createdObject: ReadCreatedObject,
    context: ProjectContext
): { created: ReturnType<ReadCreatedObject>; targetIds: string[] } {
    const createdObjectOf = readsCreatedObjects(createdObject, context);
    return {
        created: createdObjectOf(command),
        targetIds: statedIdEntries(command, createdObjectOf).map(([, value]) => value),
    };
}

/**
 * A target is identified by the command's explicit object ids, not by its place in the batch. A
 * creation is identified by where it creates and what it names, never by the id minted for it, which
 * every grounding mints afresh. A creation that names nothing ("split clip-1 at bar 4") has nothing
 * else a changed one could keep, so it pairs only with the same creation under a fresh id.
 */
function targetOf(command: Command, createdObjectOf: CreatedObjectOf): string {
    const created = createdObjectOf(command);
    if (created !== null && created.names.length === 0) {
        const minted = new Set(created.idFields);
        const stated = Object.entries(payloadOf(command)).filter(([field]) => !minted.has(field));
        return [command.type, canonicalJson(Object.fromEntries(stated))].join('|');
    }
    const ids = statedIdEntries(command, createdObjectOf).map(([field, value]) => `${field}=${value}`);
    const names = (created?.names ?? []).map((name) => `name=${name.toLowerCase()}`);
    return [command.type, ...ids, ...names].join('|');
}

/**
 * A provider may add or change grounded commands, and may remove a command the user expressly
 * dropped. It may not silently lose a command from the full held card, nor create again what the user
 * removed from it, and a removal naming a creation several pending creations share is refused rather
 * than read as either. The caller supplies the stored snapshot: thread_context can omit command
 * arguments to stay inside its provider budget.
 */
export function validateRefinedProposalActions(input: {
    pendingActions: readonly Command[] | null;
    actions: readonly Command[];
    prompt: string;
    context: ProjectContext;
    createdObject: ReadCreatedObject;
    readRemoval: ReadCommandRemoval;
}): { status: 'valid' } | { status: 'refused'; reason: string } {
    // Persistence rechecks live authority. A card cancelled during planning receives that
    // authoritative reason there, even when its displayed status has not settled.
    if (input.pendingActions === null) {
        return { status: 'valid' };
    }
    const remaining = [...input.actions];
    const oldActions = input.pendingActions;
    const createdObjectOf = readsCreatedObjects(input.createdObject, input.context);
    const removalOf = (old: Command) =>
        input.readRemoval({ prompt: input.prompt, command: old, pendingActions: oldActions, context: input.context });
    const keptRemoval = (old: Command): { status: 'refused'; reason: string } => ({
        status: 'refused',
        reason: `Refined proposal keeps the pending ${old.type} command the request removes.`,
    });
    const changed: Command[] = [];
    for (const old of oldActions) {
        const exact = remaining.findIndex((next) => canonicalJson(next) === canonicalJson(old));
        if (exact < 0) {
            changed.push(old);
            continue;
        }
        const removal = removalOf(old);
        if (removal.status === 'ambiguous') {
            return { status: 'refused', reason: removal.reason };
        }
        if (removal.status === 'removes') {
            return keptRemoval(old);
        }
        remaining.splice(exact, 1);
    }
    for (const old of changed) {
        const identity = targetOf(old, createdObjectOf);
        const changedIndex = remaining.findIndex((next) => targetOf(next, createdObjectOf) === identity);
        const removal = removalOf(old);
        if (removal.status === 'ambiguous') {
            return { status: 'refused', reason: removal.reason };
        }
        if (changedIndex >= 0) {
            // A creation pairs under the fresh id every grounding mints, so pairing alone would keep
            // one the request removes.
            if (removal.status === 'removes') {
                return keptRemoval(old);
            }
            // The ordinary grounding route has already checked this changed command against the
            // new request's target and value; keep its paired occurrence out of addition matching.
            remaining.splice(changedIndex, 1);
            continue;
        }
        if (removal.status !== 'removes') {
            return {
                status: 'refused',
                reason: `Refined proposal omits a pending ${old.type} command without an explicit request to remove it.`,
            };
        }
    }
    return { status: 'valid' };
}
