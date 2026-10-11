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

function payloadOf(command: Command): Record<string, unknown> {
    if (typeof command.payload === 'object' && command.payload !== null && !Array.isArray(command.payload)) {
        return command.payload as Record<string, unknown>;
    }
    return {};
}

/** A target is identified by the command's explicit object ids, not by its place in the batch. */
function targetOf(command: Command): string {
    const ids = Object.entries(payloadOf(command))
        .filter(([field, value]) => field.endsWith('Id') && !field.startsWith('expected') && typeof value === 'string')
        .map(([field, value]) => `${field}=${String(value)}`);
    return [command.type, ...ids].join('|');
}

function mentionsOperation(clause: string, actionType: string): boolean {
    if (actionType === 'setTrackPan') {
        return /\bpan(?:ning)?\b/i.test(clause);
    }
    if (actionType === 'setTrackGain') {
        return /\b(?:gain|fader|level)\b/i.test(clause);
    }
    if (actionType === 'muteTrack') {
        return /\bmute\b/i.test(clause);
    }
    const operation = actionType
        .match(/[A-Z][a-z]+|^[a-z]+/g)
        ?.at(-1)
        ?.toLowerCase();
    return operation !== undefined && new RegExp(`\\b${operation}\\b`, 'i').test(clause);
}

function isNegatedRemoval(clause: string, removalIndex: number): boolean {
    const beforeRemoval = clause.slice(0, removalIndex);
    return /\b(?:(?:do not|don't)\s+want(?:\s+you)?\s+to\s+|(?:not|never|don't|can't|cannot|avoid|without)\s+(?:\w+\s+){0,2})$/i.test(
        beforeRemoval
    );
}

function explicitlyRemovesCommand(prompt: string, command: Command, context: ProjectContext): boolean {
    const payload = payloadOf(command);
    const targetIds = Object.entries(payload)
        .filter(([field, value]) => field.endsWith('Id') && !field.startsWith('expected') && typeof value === 'string')
        .map(([, value]) => String(value));
    const clauses = prompt.toLowerCase().split(/[.,;]/);
    if (targetIds.length === 0) {
        return clauses.some((clause) =>
            [...clause.matchAll(/\b(?:remove|drop|omit|exclude|skip)\b/g)].some(
                (removal) => mentionsOperation(clause, command.type) && !isNegatedRemoval(clause, removal.index ?? 0)
            )
        );
    }
    return targetIds.every((id) => {
        const track = context.tracks.find((candidate) => candidate.id === id);
        const name = (track?.name ?? id).toLowerCase();
        return clauses.some((clause) => {
            const at = clause.indexOf(name);
            if (at < 0 || !mentionsOperation(clause, command.type)) {
                return false;
            }
            const preceding = clause.slice(0, at);
            const removal = [...preceding.matchAll(/\b(?:remove|drop|omit|exclude|skip)\b/g)].at(-1);
            const preservation = [...preceding.matchAll(/\b(?:keep|retain|preserve)\b/g)].at(-1);
            return (
                removal !== undefined &&
                !isNegatedRemoval(preceding, removal.index ?? 0) &&
                (preservation === undefined || (removal.index ?? -1) > (preservation.index ?? -1))
            );
        });
    });
}

/**
 * A provider may add or change grounded commands, and may remove a command the user expressly
 * dropped. It may not silently lose a command from the full held card. The caller supplies the
 * stored snapshot: thread_context can omit command arguments to stay inside its provider budget.
 */
export function validateRefinedProposalActions(input: {
    pendingActions: readonly Command[] | null;
    actions: readonly Command[];
    prompt: string;
    context: ProjectContext;
}): { status: 'valid' } | { status: 'refused'; reason: string } {
    // Persistence rechecks live authority. A card cancelled during planning receives that
    // authoritative reason there, even when its displayed status has not settled.
    if (input.pendingActions === null) {
        return { status: 'valid' };
    }
    const remaining = [...input.actions];
    const oldActions = input.pendingActions;
    const changed: Command[] = [];
    for (const old of oldActions) {
        const exact = remaining.findIndex((next) => canonicalJson(next) === canonicalJson(old));
        if (exact >= 0) {
            remaining.splice(exact, 1);
        } else {
            changed.push(old);
        }
    }
    for (const old of changed) {
        const identity = targetOf(old);
        const changedIndex = remaining.findIndex((next) => targetOf(next) === identity);
        if (changedIndex >= 0) {
            // The ordinary grounding route has already checked this changed command against the
            // new request's target and value; keep its paired occurrence out of addition matching.
            remaining.splice(changedIndex, 1);
            continue;
        }
        if (!explicitlyRemovesCommand(input.prompt, old, input.context)) {
            return {
                status: 'refused',
                reason: `Refined proposal omits a pending ${old.type} command without an explicit request to remove it.`,
            };
        }
    }
    return { status: 'valid' };
}
