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

function operationPattern(actionType: string): RegExp | null {
    if (actionType === 'setTrackPan') {
        return /\bpan(?:ning)?\b/i;
    }
    if (actionType === 'setTrackGain') {
        return /\b(?:gain|fader|level)\b/i;
    }
    if (actionType === 'muteTrack') {
        return /\bmute\b/i;
    }
    const operation = actionType
        .match(/[A-Z][a-z]+|^[a-z]+/g)
        ?.at(-1)
        ?.toLowerCase();
    return operation === undefined ? null : new RegExp(`\\b${operation}\\b`, 'i');
}

function isNegatedRemoval(clause: string, removalIndex: number): boolean {
    const beforeRemoval = clause.slice(0, removalIndex);
    return /\b(?:(?:do not|don't)\s+want(?:\s+you)?\s+to\s+|(?:not|never|don't|can't|cannot|avoid|without)\s+(?:\w+\s+){0,2})$/i.test(
        beforeRemoval
    );
}

const DIRECTIVE = /\b(?:remove|drop|omit|exclude|skip|keep|retain|preserve|leave)\b/gi;
const REMOVAL = /^(?:remove|drop|omit|exclude|skip)$/i;
const BINDING_WORDS = new Set([
    'the',
    'its',
    'pending',
    'proposed',
    'command',
    'change',
    'track',
    'clip',
    'pan',
    'panning',
    'mute',
    'gain',
    'fader',
    'level',
    'from',
    'of',
    'on',
    'for',
]);

function quotedRanges(text: string): Array<{ start: number; end: number; contentEnd: number; complete: boolean }> {
    const ranges: Array<{ start: number; end: number; contentEnd: number; complete: boolean }> = [];
    let opened: { start: number; close: string } | null = null;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (opened !== null) {
            if (character === opened.close) {
                ranges.push({ start: opened.start, end: index + 1, contentEnd: index, complete: true });
                opened = null;
            }
            continue;
        }
        if (character !== '"' && character !== "'" && character !== '“' && character !== '‘') {
            continue;
        }
        if (
            character === "'" &&
            /[\p{L}\p{N}]/u.test(text[index - 1] ?? '') &&
            /[\p{L}\p{N}]/u.test(text[index + 1] ?? '')
        ) {
            continue;
        }
        let close = character;
        if (character === '“') {
            close = '”';
        } else if (character === '‘') {
            close = '’';
        }
        opened = { start: index, close };
    }
    if (opened !== null) {
        ranges.push({ start: opened.start, end: text.length, contentEnd: text.length, complete: false });
    }
    return ranges;
}

function clausesOf(prompt: string): string[] {
    const quotes = quotedRanges(prompt);
    const clauses: string[] = [];
    let start = 0;
    for (let index = 0; index < prompt.length; index += 1) {
        if (/[.,;]/.test(prompt[index] ?? '') && !quotes.some((quote) => index >= quote.start && index < quote.end)) {
            clauses.push(prompt.slice(start, index));
            start = index + 1;
        }
    }
    clauses.push(prompt.slice(start));
    return clauses;
}

function targetMentions(clause: string, context: ProjectContext, targetIds: readonly string[]) {
    const candidates = new Map<string, Set<string>>();
    for (const track of context.tracks) {
        for (const name of [track.name, track.id]) {
            const ids = candidates.get(name.toLowerCase()) ?? new Set<string>();
            ids.add(track.id);
            candidates.set(name.toLowerCase(), ids);
        }
    }
    for (const id of targetIds) {
        const ids = candidates.get(id.toLowerCase()) ?? new Set<string>();
        ids.add(id);
        candidates.set(id.toLowerCase(), ids);
    }
    const names = Array.from(candidates.keys())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    const quotes = quotedRanges(clause);
    const mentions: Array<{ id: string | null; start: number; end: number }> = [];
    for (const name of names) {
        const ids = candidates.get(name)!;
        const id = ids.size === 1 ? [...ids][0]! : null;
        const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const match of clause.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'))) {
            const start = match.index ?? 0;
            const end = start + name.length;
            const quote = quotes.find((range) => start < range.end && end > range.start);
            if (quote !== undefined && (!quote.complete || start !== quote.start + 1 || end !== quote.contentEnd)) {
                continue;
            }
            const bindingStart = quote?.start ?? start;
            const bindingEnd = quote?.end ?? end;
            if (!mentions.some((other) => bindingStart < other.end && bindingEnd > other.start)) {
                mentions.push({ id, start: bindingStart, end: bindingEnd });
            }
        }
    }
    return mentions.sort((left, right) => left.start - right.start);
}

function onlyBindingWords(text: string): boolean {
    return (
        text === '' ||
        text
            .toLowerCase()
            .split(/\s+/)
            .every((word) => BINDING_WORDS.has(word))
    );
}

function intentionForMention(input: {
    clause: string;
    mentions: ReturnType<typeof targetMentions>;
    directives: RegExpMatchArray[];
    index: number;
    operation: RegExp;
}): 'remove' | 'preserve' | null {
    const { clause, mentions, directives, index, operation } = input;
    const mention = mentions[index]!;
    const previousEnd = mentions[index - 1]?.end ?? 0;
    const directive = directives.findLast((entry) => {
        const at = entry.index ?? 0;
        return at >= previousEnd && at < mention.start;
    });
    if (!directive) {
        return null;
    }
    const at = directive.index ?? 0;
    const beforeTarget = clause.slice(at + directive[0].length, mention.start).trim();
    if (!onlyBindingWords(beforeTarget)) {
        return null;
    }
    const nextDirective = directives.find((entry) => (entry.index ?? 0) > mention.end)?.index;
    const nextTarget = mentions[index + 1]?.start;
    const end = Math.min(nextDirective ?? clause.length, nextTarget ?? clause.length);
    const afterTarget = clause.slice(mention.end, end);
    const afterMatch = operation.exec(afterTarget);
    const beforeOperation = afterMatch === null ? '' : afterTarget.slice(0, afterMatch.index ?? 0).trim();
    if (
        (afterMatch !== null && !onlyBindingWords(beforeOperation)) ||
        (!operation.test(beforeTarget) && afterMatch === null)
    ) {
        return null;
    }
    return REMOVAL.test(directive[0]) && !isNegatedRemoval(clause, at) ? 'remove' : 'preserve';
}

/** Whether the request expressly drops this pending command, by its own target and operation. */
export function explicitlyRemovesCommand(prompt: string, command: Command, context: ProjectContext): boolean {
    const payload = payloadOf(command);
    const targetIds = Object.entries(payload)
        .filter(([field, value]) => field.endsWith('Id') && !field.startsWith('expected') && typeof value === 'string')
        .map(([, value]) => String(value));
    const clauses = clausesOf(prompt);
    if (targetIds.length === 0) {
        return false;
    }
    const operation = operationPattern(command.type);
    if (operation === null) {
        return false;
    }
    return targetIds.every((id) => {
        const intentions = clauses.flatMap((clause) => {
            const mentions = targetMentions(clause, context, targetIds);
            const quotes = quotedRanges(clause);
            const directives = Array.from(clause.matchAll(DIRECTIVE)).filter(
                (entry) => !quotes.some((quote) => (entry.index ?? 0) >= quote.start && (entry.index ?? 0) < quote.end)
            );
            return mentions.flatMap((mention, index) => {
                const intention =
                    mention.id === id ? intentionForMention({ clause, mentions, directives, index, operation }) : null;
                return intention === null ? [] : [intention];
            });
        });
        return intentions.includes('remove') && !intentions.includes('preserve');
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
