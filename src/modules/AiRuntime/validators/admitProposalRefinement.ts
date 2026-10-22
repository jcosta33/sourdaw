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

/**
 * Whether a removal verb opens its clause, after nothing but `please`, `and` or `then`. A removal verb
 * anywhere else ("don’t remove", "you shouldn't remove", "no need to remove") removes nothing.
 */
function opensClause(clause: string, removalIndex: number): boolean {
    return /^\s*(?:(?:please|and|then)\s+)*$/iu.test(clause.slice(0, removalIndex));
}

const DIRECTIVE = /\b(?:remove|drop|omit|exclude|skip|keep|retain|preserve|leave)\b/gi;
const REMOVAL = /^(?:remove|drop|omit|exclude|skip)$/i;
const BINDING_WORDS = new Set([
    'the',
    'new',
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
    /** The word the operation is named by, or `null` when the mention names the whole change, as a created object's name does. */
    operation: RegExp | null;
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
    const intention = REMOVAL.test(directive[0]) && opensClause(clause, at) ? 'remove' : 'preserve';
    if (operation === null) {
        return intention;
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
    return intention;
}

type MentionIntention = {
    clause: string;
    mention: ReturnType<typeof targetMentions>[number];
    intention: 'remove' | 'preserve';
};

/** Each mention of this id a directive governs, by clause, with what the directive asks of it. */
function readMentionIntentions(input: {
    prompt: string;
    context: ProjectContext;
    candidateIds: readonly string[];
    id: string;
    operation: RegExp | null;
}): MentionIntention[] {
    return clausesOf(input.prompt).flatMap((clause) => {
        const mentions = targetMentions(clause, input.context, input.candidateIds);
        const quotes = quotedRanges(clause);
        const directives = Array.from(clause.matchAll(DIRECTIVE)).filter(
            (entry) => !quotes.some((quote) => (entry.index ?? 0) >= quote.start && (entry.index ?? 0) < quote.end)
        );
        return mentions.flatMap((mention, index) => {
            if (mention.id !== input.id) {
                return [];
            }
            const intention = intentionForMention({ clause, mentions, directives, index, operation: input.operation });
            return intention === null ? [] : [{ clause, mention, intention }];
        });
    });
}

/** Whether every clause naming this id with a directive removes it, and at least one does. */
function removesMentioned(intentions: readonly MentionIntention[]): boolean {
    return (
        intentions.some((entry) => entry.intention === 'remove') &&
        !intentions.some((entry) => entry.intention === 'preserve')
    );
}

type PendingCreation = { command: Command; names: readonly string[]; hostIds: readonly string[] };

/**
 * The hosts a removal names after the created object it removes, across binding words only ("the
 * compressor from Bass", "the compressor on Bass").
 */
function findNamedHosts(
    entry: MentionIntention,
    creations: readonly PendingCreation[],
    context: ProjectContext
): Set<string> {
    const hostIds = Array.from(new Set(creations.flatMap((creation) => creation.hostIds)));
    const { clause, mention } = entry;
    return new Set(
        targetMentions(clause, context, hostIds).flatMap((host) => {
            if (host.id === null || host.start < mention.end) {
                return [];
            }
            return onlyBindingWords(clause.slice(mention.end, host.start).trim()) ? [host.id] : [];
        })
    );
}

/**
 * The pending creations one removal of a name picks out: those it names by name and host, or, when it
 * names no host, every pending creation of that name.
 */
function pickCreations(
    entry: MentionIntention,
    name: string,
    creations: readonly PendingCreation[],
    context: ProjectContext
): Command[] {
    const sameName = creations.filter((creation) =>
        creation.names.some((candidate) => candidate.toLowerCase() === name.toLowerCase())
    );
    const hosts = findNamedHosts(entry, sameName, context);
    const picked =
        hosts.size === 0 ? sameName : sameName.filter((creation) => creation.hostIds.some((id) => hosts.has(id)));
    return picked.map((creation) => creation.command);
}

/**
 * Whether the request expressly drops this pending command, by its own target and operation. A
 * creation is dropped by the name of what it creates ("remove the compressor"), which names the whole
 * change; the id minted for it names nothing the user can say. That removal must pick out exactly this
 * one pending creation, by its name and host ("remove the compressor from Bass") or by a name no other
 * pending creation shares; otherwise it removes nothing.
 */
export function explicitlyRemovesCommand(input: {
    prompt: string;
    command: Command;
    pendingActions: readonly Command[];
    context: ProjectContext;
    createdObject: ReadCreatedObject;
}): boolean {
    const { prompt, command, context } = input;
    const createdObjectOf = readsCreatedObjects(input.createdObject, context);
    const created = createdObjectOf(command);
    if (created !== null) {
        const creations = input.pendingActions.flatMap((pending): PendingCreation[] => {
            const names = createdObjectOf(pending)?.names;
            if (names === undefined) {
                return [];
            }
            const hostIds = statedIdEntries(pending, createdObjectOf).map(([, value]) => value);
            return [{ command: pending, names, hostIds }];
        });
        return created.names.some((name) => {
            const intentions = readMentionIntentions({
                prompt,
                context,
                candidateIds: created.names,
                id: name,
                operation: null,
            });
            return (
                removesMentioned(intentions) &&
                intentions.some((entry) => {
                    const picked = pickCreations(entry, name, creations, context);
                    return picked.length === 1 && picked[0] === command;
                })
            );
        });
    }
    const targetIds = statedIdEntries(command, createdObjectOf).map(([, value]) => value);
    if (targetIds.length === 0) {
        return false;
    }
    const operation = operationPattern(command.type);
    if (operation === null) {
        return false;
    }
    return targetIds.every((id) =>
        removesMentioned(readMentionIntentions({ prompt, context, candidateIds: targetIds, id, operation }))
    );
}

/**
 * A provider may add or change grounded commands, and may remove a command the user expressly
 * dropped. It may not silently lose a command from the full held card, nor create again what the user
 * removed from it. The caller supplies the
 * stored snapshot: thread_context can omit command arguments to stay inside its provider budget.
 */
export function validateRefinedProposalActions(input: {
    pendingActions: readonly Command[] | null;
    actions: readonly Command[];
    prompt: string;
    context: ProjectContext;
    createdObject: ReadCreatedObject;
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
    const createdObjectOf = readsCreatedObjects(input.createdObject, input.context);
    for (const old of changed) {
        const identity = targetOf(old, createdObjectOf);
        const changedIndex = remaining.findIndex((next) => targetOf(next, createdObjectOf) === identity);
        const removed = explicitlyRemovesCommand({
            prompt: input.prompt,
            command: old,
            pendingActions: oldActions,
            context: input.context,
            createdObject: input.createdObject,
        });
        if (changedIndex >= 0) {
            // A creation pairs under the fresh id every grounding mints, so pairing alone would keep
            // one the request removes.
            if (removed && createdObjectOf(old) !== null) {
                return {
                    status: 'refused',
                    reason: `Refined proposal keeps the pending ${old.type} command the request removes.`,
                };
            }
            // The ordinary grounding route has already checked this changed command against the
            // new request's target and value; keep its paired occurrence out of addition matching.
            remaining.splice(changedIndex, 1);
            continue;
        }
        if (!removed) {
            return {
                status: 'refused',
                reason: `Refined proposal omits a pending ${old.type} command without an explicit request to remove it.`,
            };
        }
    }
    return { status: 'valid' };
}
