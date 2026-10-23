import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis } from '../../models/ProposalGroundingBasis';

import { type RefinementClause } from './bindRefinementFigure';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { refinementCardCommands, type CommandView } from './refinementCardCommands';
import { refinementProtectionForms } from './refinementProtectionForms';
import { refinementRequestReading, type ReferenceCandidate, type StatedReference } from './refinementRequestReading';

type ProtectedObject = ProposalGroundingBasis['protectedUnchanged'][number];

type ProtectionRead = NonNullable<ReturnType<typeof refinementProtectionForms.read>>;

/**
 * What a refinement removes from the pending card. A removal names one object of that card in whole,
 * after its article and an optional operation word; a name merely contained in the phrase never
 * counts. Its verb is one of the shared removal verbs, after nothing but the shared openers. A
 * negation removes only in the form `not`/`except`/`except for`/`without` [the] <object> [operation
 * word]: naming a pending object it removes that object's changes (of the operation the word
 * states), naming a project object outside the card it protects that object; right before or after a
 * removal clause it is asked instead, as a "leave ... alone" there is. Any other negated
 * clause is asked, unless it names no project object and states no figure ("not too loud"), which is
 * read and left alone.
 */
type RefinementRemovals =
    | { status: 'refused'; reason: string }
    | { status: 'clarify'; reason: string; question: string }
    | {
          status: 'read';
          removedCommandIndexes: ReadonlySet<number>;
          /** Objects whose every pending command the refinement removed; they stay unchanged. */
          removedTargets: ProtectedObject[];
          /** Objects outside the card the refinement asks to leave alone. */
          protectedTargets: ProtectedObject[];
          removalClauseStarts: ReadonlySet<number>;
          /** Negations naming no project object ("not too loud", "not less"), read and left alone. */
          unreadNegations: readonly RefinementClause[];
      };

type RemovalClauseRead =
    | { kind: 'none' }
    /** `removes` is set for a removal a following bare object name may continue, never a protection. */
    | { kind: 'read'; removes: boolean }
    | { kind: 'unread-negation' }
    | { kind: 'refused'; reason: string }
    | { kind: 'clarify'; question: string; reason?: string };

type RemovalClauseInput = {
    clause: RefinementClause;
    commands: readonly CommandView[];
    candidates: readonly ReferenceCandidate[];
    /** Every object id a pending command acts on, the removed ones included. */
    pendingIds: ReadonlySet<string>;
    context: ProjectContext;
    removed: Set<number>;
    removedTargets: ProtectedObject[];
    protectedTargets: ProtectedObject[];
    /** Set when the clause before this one removed by a removal verb. */
    continuesRemoval: boolean;
    /** Set when the clause after this one opens with a removal verb. */
    precedesRemoval: boolean;
    /** Set when the clause before this one is a protection or a rest-of-mix clause. */
    followsProtection: boolean;
};

const NEGATED_CLAUSE_REASON = 'The refinement says what not to do without naming one pending change to remove.';
const PROTECTION_REASON =
    'The refinement keeps something unchanged that it cannot protect apart from the pending changes.';

const normalizedClause = refinementRequestReading.clauseWords;

/** The one form a negation removes or protects in: `not`/`except`/`except for`/`without` and what follows. */
const NEGATION_FORM = /^(?:not|except(?:\s+for)?|without)\s+(.+)$/u;
/** The exception a protection may carry, which the splitter cuts off it as a clause of its own. */
const EXCEPTION_FORM = /^(?:except|without)\s/u;
const LEAVE_ALONE = /^leave\s+(.+?)\s+alone$/u;
/** What may stand between two clauses the splitter cut inside one protection's list of objects. */
const LIST_SEPARATOR = /^\s*(?:,\s*(?:and\s+)?|and\s+)$/iu;

function describeUnresolvedRemoval(reference: string, what: 'object' | 'change'): string {
    return `The refinement removes "${reference}", which names no single ${what} of the pending proposal.`;
}

/**
 * A negated clause outside the one form a negation removes in ("don't raise Snare", "not the snare at
 * 2 dB", "never boost Snare") says what not to do in words this reading does not bind: it is asked,
 * unless it names no project object and states no figure ("without changing anything else"), which
 * is read and left alone.
 */
function readOtherNegation(clause: RefinementClause, candidates: readonly ReferenceCandidate[]): RemovalClauseRead {
    const statesFigure = findPromptNumbers(clause.masked).length > 0;
    if (!statesFigure && refinementRequestReading.references(clause.text, candidates).length === 0) {
        return { kind: 'unread-negation' };
    }
    return {
        kind: 'clarify',
        question: `"${clause.text.trim()}" says what not to do. Name the pending change to remove, as in "not the snare", or say what it should be instead.`,
    };
}

/**
 * A clause that is nothing but a whole object name right after a removal ("remove the guitar pan and
 * the vocal gain") continues that removal; any other clause there is read on its own. A clause stating
 * a figure continues nothing, which the removal clause reading checks for every removal it reads.
 */
function readRemovalContinuation(clause: RefinementClause, candidates: readonly ReferenceCandidate[]): string | null {
    const text = normalizedClause(clause);
    return refinementRequestReading.resolveReference(text, candidates) === null ? null : text;
}

/**
 * A negation or a "leave ... alone" right before or after a removal ("remove the snare but not the
 * drum bus", "remove snare except snare bottom", "remove the snare but leave the bass alone") may
 * narrow that removal or keep another change, which no reading can tell apart, so it is asked rather
 * than read as a removal or protection of its own.
 */
function askNegationBesideRemoval(clause: RefinementClause): RemovalClauseRead {
    return {
        kind: 'clarify',
        question: `"${clause.text.trim()}" beside a removal does not say whether it narrows that removal or keeps another change. Name each pending change to remove, as in "remove the snare".`,
    };
}

/**
 * An `except`/`without` right after a protection or a rest-of-mix clause ("keep everything else
 * unchanged except the snare", "leaving the drum bus unchanged, except the snare") may carve its object
 * out of that protection, so the pending change on it stands, or remove that change, which no reading
 * can tell apart, so it is asked rather than read as a removal. One naming no project object ("without
 * changing anything else") carves nothing out and is read as any other negation is.
 */
function askExceptionAfterProtection(clause: RefinementClause): RemovalClauseRead {
    return {
        kind: 'clarify',
        question: `"${clause.text.trim()}" after a protection does not say whether it keeps that change or removes it. Name each pending change to remove, as in "remove the snare", or the objects to keep unchanged, as in "keep the Bass unchanged".`,
    };
}

/** Whether an `except`/`without` clause names a project object it could carve out of a protection. */
function carvesExceptionOut(
    clause: RefinementClause,
    text: string,
    candidates: readonly ReferenceCandidate[]
): boolean {
    return EXCEPTION_FORM.test(text) && refinementRequestReading.references(clause.text, candidates).length > 0;
}

function readRemovalClause(input: RemovalClauseInput): RemovalClauseRead {
    const { clause, candidates } = input;
    const text = normalizedClause(clause);
    const early = readProtectionOrNegation(input, text);
    if (early !== null) {
        return early;
    }
    const negation = NEGATION_FORM.exec(text);
    const alone = LEAVE_ALONE.exec(text);
    const statesFigure = findPromptNumbers(clause.masked).length > 0;
    const stated =
        (negation ?? alone)?.[1] ??
        refinementRequestReading.removalObject(clause) ??
        (input.continuesRemoval ? readRemovalContinuation(clause, candidates) : null);
    if (stated === null || (statesFigure && negation === null)) {
        return { kind: 'none' };
    }
    const resolved = refinementRequestReading.resolveReference(stated, candidates);
    if (resolved === null) {
        if (negation !== null) {
            return readOtherNegation(clause, candidates);
        }
        return { kind: 'refused', reason: describeUnresolvedRemoval(stated, 'object') };
    }
    const protects = alone !== null || negation !== null;
    const read = removeNamedObject(input, { stated, ...resolved, protects });
    return read.kind === 'read' ? { kind: 'read', removes: !protects } : read;
}

function askProtection(clause: RefinementClause): RemovalClauseRead {
    return {
        kind: 'clarify',
        reason: PROTECTION_REASON,
        question: `"${clause.text.trim()}" keeps something a pending change acts on, or names no one object. Name each object off the proposal to keep, as in "keep the Bass unchanged", or the pending change to remove, as in "remove the snare".`,
    };
}

/** Protect each object off the card a protection names through the chain, or ask one it cannot protect. */
function applyProtection(
    input: RemovalClauseInput,
    clause: RefinementClause,
    protection: Extract<ProtectionRead, { kind: 'protects' | 'asked' }>
): RemovalClauseRead {
    if (protection.kind === 'asked') {
        return askProtection(clause);
    }
    for (const id of protection.ids) {
        input.protectedTargets.push({ id, name: refinementCardCommands.name(input.context, id) });
    }
    return { kind: 'read', removes: false };
}

/**
 * A protection or a negation, read before any removal: the rest of the mix wherever it stands, then a
 * negation or `leave`/`leaving` … `alone` beside a removal, which is asked, any other negation, and
 * any other protection by what it names.
 */
function readProtectionOrNegation(input: RemovalClauseInput, text: string): RemovalClauseRead | null {
    const { clause, candidates } = input;
    const protection = refinementProtectionForms.read(text, input);
    if (protection?.kind === 'rest') {
        return { kind: 'read', removes: false };
    }
    const negation = NEGATION_FORM.exec(text);
    if (negation !== null && input.followsProtection && carvesExceptionOut(clause, text, candidates)) {
        return askExceptionAfterProtection(clause);
    }
    const leftAlone = LEAVE_ALONE.test(text) || protection?.leaveAlone === true;
    if ((negation !== null || leftAlone) && (input.continuesRemoval || input.precedesRemoval)) {
        return askNegationBesideRemoval(clause);
    }
    if (negation === null && refinementRequestReading.statesNegation(clause)) {
        return readOtherNegation(clause, candidates);
    }
    if (protection === null || protection.kind === 'removal') {
        return null;
    }
    return applyProtection(input, clause, protection);
}

/** The clauses from `index` on that follow one another across nothing but list separators. */
function readListStretch(clauses: readonly RefinementClause[], index: number, text: string): RefinementClause[] {
    const stretch = [clauses[index]!];
    for (const next of clauses.slice(index + 1)) {
        if (!LIST_SEPARATOR.test(text.slice(stretch.at(-1)!.end, next.start))) {
            break;
        }
        stretch.push(next);
    }
    return stretch;
}

/**
 * Remove the pending changes on the one object a removal names in whole, or protect the object it
 * names off the card when the removal is a negation or a "leave ... alone".
 */
function removeNamedObject(
    input: RemovalClauseInput,
    named: {
        stated: string;
        reference: StatedReference;
        candidate: ReferenceCandidate;
        protects: boolean;
    }
): { kind: 'read' } | { kind: 'refused'; reason: string } {
    const { commands, context } = input;
    const { stated, reference, candidate } = named;
    const onTarget = commands.filter(
        (view) =>
            refinementCardCommands.intersects(view.denotes, candidate.denotes) &&
            (reference.operations === null || reference.operations.includes(view.command.type))
    );
    const pendingObjectIds = Array.from(candidate.denotes).filter((id) =>
        commands.some((view) => view.denotes.has(id))
    );
    const [pendingObjectId] = pendingObjectIds;
    if (onTarget.length === 0 || pendingObjectId === undefined || pendingObjectIds.length !== 1) {
        const [outsideId] = Array.from(candidate.denotes);
        if (
            named.protects &&
            pendingObjectIds.length === 0 &&
            candidate.denotes.size === 1 &&
            outsideId !== undefined
        ) {
            input.protectedTargets.push({ id: outsideId, name: refinementCardCommands.name(context, outsideId) });
            return { kind: 'read' };
        }
        return { kind: 'refused', reason: describeUnresolvedRemoval(stated, 'change') };
    }
    for (const view of onTarget) {
        input.removed.add(view.index);
    }
    if (reference.operations === null) {
        input.removedTargets.push({ id: pendingObjectId, name: refinementCardCommands.name(context, pendingObjectId) });
    }
    return { kind: 'read' };
}

/** Whether the clause before this one takes a closed protection form, the rest of the mix included. */
function followsProtection(
    clauses: readonly RefinementClause[],
    index: number,
    scope: Pick<RemovalClauseInput, 'candidates' | 'pendingIds'>
): boolean {
    const previous = clauses[index - 1];
    return previous !== undefined && refinementProtectionForms.read(normalizedClause(previous), scope) !== null;
}

/** Whether the clause after this one opens with a removal verb. */
function precedesRemoval(clauses: readonly RefinementClause[], index: number): boolean {
    const next = clauses[index + 1];
    return next !== undefined && refinementRequestReading.removalObject(next) !== null;
}

/**
 * Read the clause at `index`, or the run of clauses from it that one protection naming several
 * objects spans, and the index of the last clause read.
 */
function readRemovalStep(
    clauses: readonly RefinementClause[],
    index: number,
    text: string,
    input: RemovalClauseInput
): { outcome: RemovalClauseRead; last: number } {
    const stretch = readListStretch(clauses, index, text);
    const list = refinementProtectionForms.readList(stretch.map(normalizedClause), input);
    if (list === null) {
        return { outcome: readRemovalClause(input), last: index };
    }
    const last = index + list.count - 1;
    const stated = { ...input.clause, text: text.slice(input.clause.start, clauses[last]!.end) };
    if (list.read.leaveAlone && (input.continuesRemoval || precedesRemoval(clauses, last))) {
        return { outcome: askNegationBesideRemoval(stated), last };
    }
    return { outcome: applyProtection(input, stated, list.read), last };
}

/** Read every removal clause of a refinement against the pending card it refines. */
function readRefinementRemovals(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
}): RefinementRemovals {
    const commands = refinementCardCommands.view(input.basis, input.context);
    const candidates = refinementRequestReading.candidates(input.context);
    const removed = new Set<number>();
    const removedTargets: ProtectedObject[] = [];
    const protectedTargets: ProtectedObject[] = [];
    const removalClauseStarts = new Set<number>();
    const unreadNegations: RefinementClause[] = [];
    const pendingIds = new Set(commands.flatMap((view) => Array.from(view.denotes)));
    let continuesRemoval = false;
    const clauses = refinementRequestReading.clauses(input.text, input.context);
    let index = 0;
    while (index < clauses.length) {
        const clause = clauses[index]!;
        const { outcome, last } = readRemovalStep(clauses, index, input.text, {
            clause,
            commands,
            candidates,
            pendingIds,
            context: input.context,
            removed,
            removedTargets,
            protectedTargets,
            continuesRemoval,
            precedesRemoval: precedesRemoval(clauses, index),
            followsProtection: followsProtection(clauses, index, { candidates, pendingIds }),
        });
        const read = clauses.slice(index, last + 1);
        index = last + 1;
        continuesRemoval = outcome.kind === 'read' && outcome.removes;
        if (outcome.kind === 'none') {
            continue;
        }
        if (outcome.kind === 'refused') {
            return { status: 'refused', reason: outcome.reason };
        }
        if (outcome.kind === 'clarify') {
            return { status: 'clarify', reason: outcome.reason ?? NEGATED_CLAUSE_REASON, question: outcome.question };
        }
        if (outcome.kind === 'unread-negation') {
            unreadNegations.push(clause);
        }
        for (const consumed of read) {
            removalClauseStarts.add(consumed.start);
        }
    }
    return {
        status: 'read',
        removedCommandIndexes: removed,
        removedTargets,
        protectedTargets,
        removalClauseStarts,
        unreadNegations,
    };
}

/**
 * How a refinement's removal, negation and protection clauses read against the pending card it refines,
 * before any value clause is read.
 */
export const refinementRemovalReading = {
    read: readRefinementRemovals,
    negatedClauseReason: NEGATED_CLAUSE_REASON,
} as const;
