import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis } from '../../models/ProposalGroundingBasis';

import {
    bindRefinementFigure,
    refinementFigure,
    type BoundRefinementValue,
    type RefinementClause,
} from './bindRefinementFigure';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { type PromptClause } from './groundingStrategies/promptScope';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { refinementActionWords } from './refinementActionWords';
import { refinementCardCommands, type CommandView } from './refinementCardCommands';
import { refinementCourtesy } from './refinementCourtesy';
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

type RefinementValueBinding =
    | { status: 'clarify'; reason: string; question: string }
    | { status: 'refused'; reason: string }
    | {
          status: 'bound';
          values: ReadonlyMap<number, BoundRefinementValue>;
          comparative: 'less' | 'more' | null;
      };

/**
 * How one clause the refinement does not remove reads against the pending card, before its figure is
 * read: filler it consumes, a comparative of its own, an addition naming an object no pending command
 * acts on, or the kept pending commands it can mean. A protection is consumed only where the removal
 * reading reads it, never here.
 */
type ClauseScope =
    | { kind: 'consumed' }
    | { kind: 'comparative'; comparative: 'less' | 'more' }
    | { kind: 'addition' }
    | {
          kind: 'scoped';
          meant: readonly CommandView[];
          removed: readonly CommandView[];
          namesObjects: boolean;
          statesAction: boolean;
      };

type ClauseRead = Exclude<ClauseScope, { kind: 'scoped' }> | ReturnType<typeof bindRefinementFigure>;

type ClauseScopeInput = {
    commands: readonly CommandView[];
    removedCommandIndexes: ReadonlySet<number>;
    candidates: readonly ReferenceCandidate[];
    catalog: ReturnType<typeof getExecutableAppActionGroundingCatalog>;
    /** Each pending command's own action words, as the source clause that grounded it states them. */
    ownActionWords: (index: number) => readonly string[] | null;
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
};

const OPEN_VALUE_REASON = 'The refinement leaves part of the change it asks for open.';
const NEGATED_CLAUSE_REASON = 'The refinement says what not to do without naming one pending change to remove.';
const PROTECTION_REASON =
    'The refinement keeps something unchanged that it cannot protect apart from the pending changes.';
const LEADING_CONNECTOR = /^(?:(?:and|but|also|then|just|please|ok|okay)\s+)+/u;
const COMPARATIVE =
    /^(?:(?:make it|go|do it)\s+)?(?:(?:a\s+)?(?:bit|little|touch|tad|lot)\s+|slightly\s+|much\s+|even\s+)?(less|more)(?:\s+please)?$/u;
/** The one form a negation removes or protects in: `not`/`except`/`except for`/`without` and what follows. */
const NEGATION_FORM = /^(?:not|except(?:\s+for)?|without)\s+(.+)$/u;
const LEAVE_ALONE = /^leave\s+(.+?)\s+alone$/u;
/** What may stand between two clauses the splitter cut inside one protection's list of objects. */
const LIST_SEPARATOR = /^\s*(?:,\s*(?:and\s+)?|and\s+)$/iu;

function normalizedClause(clause: PromptClause): string {
    return normalizePromptText(clause.text).replace(LEADING_CONNECTOR, '');
}

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
 * What one clause the refinement does not remove can mean on the pending card. A clause naming any
 * object no pending command acts on is an addition, grounded from the refinement text alone, and never
 * binds a pending command; otherwise it means the kept commands it names, narrowed to the action it
 * states, or every kept command when it names none. Only the closed filler list is consumed: a clause
 * naming nothing and stating no figure outside it ("slower", "double it") is an addition a batch must
 * answer, never read as saying nothing.
 */
function readClauseScope(clause: RefinementClause, input: ClauseScopeInput): ClauseScope {
    const { commands, candidates } = input;
    const text = normalizedClause(clause);
    if (text.length === 0 || refinementCourtesy.filler.has(text)) {
        return { kind: 'consumed' };
    }
    const comparative = COMPARATIVE.exec(text)?.[1];
    if (comparative === 'less' || comparative === 'more') {
        return { kind: 'comparative', comparative };
    }
    const references = refinementRequestReading.references(clause.text, candidates);
    const pendingIds = new Set(commands.flatMap((view) => Array.from(view.denotes)));
    if (references.some((reference) => !refinementCardCommands.intersects(reference.denotes, pendingIds))) {
        return { kind: 'addition' };
    }
    const intent = resolveClauseActionIntent(clause.masked, input.catalog)?.actionType ?? null;
    const meant = commands.filter(
        (view) =>
            (intent === null || view.command.type === intent) &&
            (references.length === 0 ||
                references.some((reference) => refinementCardCommands.intersects(reference.denotes, view.denotes)))
    );
    return {
        kind: 'scoped',
        meant: meant.filter((view) => !input.removedCommandIndexes.has(view.index)),
        removed: meant.filter((view) => input.removedCommandIndexes.has(view.index)),
        namesObjects: references.length > 0,
        statesAction: intent !== null,
    };
}

/** The first clause of the request text that grounded a pending command naming its object and stating its action. */
function findSourceClause(
    view: CommandView | undefined,
    basis: ProposalGroundingBasis,
    context: ProjectContext,
    candidates: readonly ReferenceCandidate[],
    catalog: ClauseScopeInput['catalog']
): RefinementClause | undefined {
    if (view === undefined) {
        return undefined;
    }
    const source = basis.sources[view.command.source];
    if (source === undefined) {
        return undefined;
    }
    return refinementRequestReading
        .clauses(source.text, context)
        .find(
            (clause) =>
                refinementRequestReading
                    .references(clause.text, candidates)
                    .some((reference) => refinementCardCommands.intersects(reference.denotes, view.denotes)) &&
                resolveClauseActionIntent(clause.masked, catalog)?.actionType === view.command.type
        );
}

/**
 * The words each pending command's own source clause states its action in. A command no clause of
 * its source text names and states the action of has none, so no clause restates it.
 */
function readOwnActionWordsOf(
    basis: ProposalGroundingBasis,
    context: ProjectContext,
    commands: readonly CommandView[],
    candidates: readonly ReferenceCandidate[],
    catalog: ClauseScopeInput['catalog']
): (index: number) => readonly string[] | null {
    const read = new Map<number, readonly string[] | null>();
    return (index) => {
        const known = read.get(index);
        if (known !== undefined) {
            return known;
        }
        let words: readonly string[] | null = null;
        const clause = findSourceClause(commands[index], basis, context, candidates, catalog);
        if (clause !== undefined) {
            words = refinementFigure.ownActionWords(clause);
        }
        read.set(index, words);
        return words;
    };
}

function createClauseScopeInput(input: {
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removedCommandIndexes: ReadonlySet<number>;
}): ClauseScopeInput {
    const commands = refinementCardCommands.view(input.basis, input.context);
    const candidates = refinementRequestReading.candidates(input.context);
    const catalog = getExecutableAppActionGroundingCatalog();
    return {
        commands,
        removedCommandIndexes: input.removedCommandIndexes,
        candidates,
        catalog,
        ownActionWords: readOwnActionWordsOf(input.basis, input.context, commands, candidates, catalog),
    };
}

function readValueClause(clause: RefinementClause, input: ClauseScopeInput, context: ProjectContext): ClauseRead {
    const scope = readClauseScope(clause, input);
    if (scope.kind !== 'scoped') {
        return scope;
    }
    return bindRefinementFigure({
        clause,
        scoped: scope.meant,
        removed: scope.removed,
        namesObjects: scope.namesObjects,
        statesAction: scope.statesAction,
        ownActionWords: input.ownActionWords,
        context,
    });
}

/**
 * Whether the refinement's clauses combine into values one clause each states. A refinement binds a
 * pending command's value from at most one clause: a figure, direction or unit for the same command
 * in two clauses ("turn Vocals up, make it 2 dB", "make it 2 dB, Vocals louder") is asked, whichever
 * comes first, rather than read as one value. A clause with no figure naming pending objects restates
 * them only in their own action words, and one naming none only in the direction its command already
 * takes; anything else is asked, on either route.
 */
function readClauseCombination(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
}): { status: 'read' } | { status: 'clarify'; reason: string; question: string } {
    const question = findClauseCombinationQuestion(input);
    return question === null ? { status: 'read' } : { status: 'clarify', reason: OPEN_VALUE_REASON, question };
}

function findClauseCombinationQuestion(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
}): string | null {
    const scopeInput = createClauseScopeInput(input);
    const stating = new Set<number>();
    for (const clause of refinementRequestReading.clauses(input.text, input.context)) {
        if (input.removalClauseStarts.has(clause.start)) {
            continue;
        }
        const statesValue = refinementFigure.statesValue(clause);
        const scope = readClauseScope(clause, scopeInput);
        if (scope.kind !== 'scoped' || (!statesValue && !scope.namesObjects)) {
            continue;
        }
        for (const view of scope.meant.filter((meant) =>
            refinementFigure.canMean(clause, meant.command, input.context)
        )) {
            const restated = refinementFigure.restatementQuestion({
                clause,
                command: view.command,
                namesObjects: scope.namesObjects,
                ownActionWords: scopeInput.ownActionWords(view.index),
                context: input.context,
            });
            if (restated !== null) {
                return restated;
            }
            if (!statesValue && refinementActionWords.toggle(clause, view.command) === null) {
                continue;
            }
            if (stating.has(view.index)) {
                return `The refinement states the value of one pending change in more than one clause. State it once, as in "make it 2 dB".`;
            }
            stating.add(view.index);
        }
    }
    return null;
}

/** The comparative a refinement states on its own as a clause ("less", "a bit more"), if any. */
function readRefinementComparative(text: string, context: ProjectContext): 'less' | 'more' | 'both' | null {
    const stated = new Set(
        refinementRequestReading.clauses(text, context).flatMap((clause): Array<'less' | 'more'> => {
            const comparative = COMPARATIVE.exec(normalizedClause(clause))?.[1];
            return comparative === 'less' || comparative === 'more' ? [comparative] : [];
        })
    );
    if (stated.size > 1) {
        return 'both';
    }
    const [only] = Array.from(stated);
    return only ?? null;
}

/**
 * Bind the values a refinement's clauses state to the pending commands they refine. One clause binds
 * one value to one pending command the refinement keeps: the command it names, or the only kept
 * pending value of the stated unit when it names none; the clause combination read first holds every
 * command to one such clause. Anything a clause leaves open — which command,
 * which unit, which way — is asked rather than guessed, and a clause naming an object outside the card
 * is an addition that a new command must answer. A negation naming no object beside a bound value is
 * asked, before any call is checked against it.
 */
function bindRefinementValues(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
    unreadNegations: readonly RefinementClause[];
}): RefinementValueBinding {
    const scopeInput = createClauseScopeInput(input);
    const values = new Map<number, BoundRefinementValue>();
    let comparative: 'less' | 'more' | null = null;
    for (const clause of refinementRequestReading.clauses(input.text, input.context)) {
        if (input.removalClauseStarts.has(clause.start)) {
            continue;
        }
        const read = readValueClause(clause, scopeInput, input.context);
        switch (read.kind) {
            case 'consumed':
            case 'restated':
            case 'addition':
                break;
            case 'comparative':
                if (comparative !== null && comparative !== read.comparative) {
                    return { status: 'clarify', reason: OPEN_VALUE_REASON, question: 'Less or more?' };
                }
                comparative = read.comparative;
                break;
            case 'value':
                values.set(read.index, read.value);
                break;
            case 'clarify':
                return { status: 'clarify', reason: OPEN_VALUE_REASON, question: read.question };
            case 'refused':
                return { status: 'refused', reason: read.reason };
        }
    }
    const unreadNegation = askUnreadNegation({ ...input, bindsValue: values.size > 0 });
    if (unreadNegation !== null) {
        return { status: 'clarify', ...unreadNegation };
    }
    if (comparative !== null && values.size === 0) {
        const question = `How much ${comparative}? State the new value, for example "${comparative}, make it 1.5 dB".`;
        return { status: 'clarify', reason: OPEN_VALUE_REASON, question };
    }
    return { status: 'bound', values, comparative };
}

/**
 * A negation naming no object ("not as much", "never mind", "not less", "or not") says something about
 * a change no clause names. On its own it is read and left alone; beside a removal, a value the
 * refinement binds or changes, or a comparative it states, it is asked, whichever route grounded the
 * batch: it may withdraw that removal or change that value ("remove the snare, or not"). The inherited
 * route asks it while binding, and the final check every route passes asks it beside a removal or a
 * pending value the batch changes.
 */
function askUnreadNegation(input: {
    text: string;
    context: ProjectContext;
    unreadNegations: readonly RefinementClause[];
    removedCommandIndexes: ReadonlySet<number>;
    bindsValue: boolean;
}): { reason: string; question: string } | null {
    const [unreadNegation] = input.unreadNegations;
    if (unreadNegation === undefined) {
        return null;
    }
    if (input.removedCommandIndexes.size > 0) {
        return {
            reason: NEGATED_CLAUSE_REASON,
            question: `"${unreadNegation.text.trim()}" beside a removal does not say whether that change is removed. Name each pending change to remove, as in "remove the snare".`,
        };
    }
    if (!input.bindsValue && readRefinementComparative(input.text, input.context) === null) {
        return null;
    }
    return {
        reason: OPEN_VALUE_REASON,
        question: `"${unreadNegation.text.trim()}" does not say what the value should be. State the new value alone, for example "make it 1.5 dB".`,
    };
}

/**
 * The clauses a refinement asks for something the pending card does not carry in: each names an object
 * no pending command acts on, or an action no pending command it names takes, so a new command must
 * answer it. Removal clauses are read as removals, never as additions. With `readsCourtesy`, set only
 * when the refinement text grounded the whole batch by itself, a clause of the closed courtesy list
 * asks for nothing too; otherwise only the closed filler list is consumed.
 */
function readAdditionClauses(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
    readsCourtesy: boolean;
}): RefinementClause[] {
    const scopeInput = createClauseScopeInput(input);
    const additions = refinementRequestReading
        .clauses(input.text, input.context)
        .filter(
            (clause) =>
                !input.removalClauseStarts.has(clause.start) &&
                readValueClause(clause, scopeInput, input.context).kind === 'addition'
        );
    if (!input.readsCourtesy) {
        return additions;
    }
    return additions.filter((clause) => !statesCourtesy(clause));
}

/**
 * Whether a clause is exactly one entry of the closed courtesy list, read from its words outside the
 * object names it states, so a clause naming an object is never courtesy.
 */
function statesCourtesy(clause: RefinementClause): boolean {
    return refinementCourtesy.clauses.has(normalizePromptText(clause.masked).replace(LEADING_CONNECTOR, ''));
}

/**
 * Whether a clause the refinement does not remove states a comparative beside its figure ("2 dB more",
 * "1 dB quieter"). Such a clause is read against the pending value it compares with, never admitted
 * as the plain figure a request reading the refinement text alone would take it for.
 */
function statesFigureComparative(input: {
    text: string;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
}): boolean {
    return refinementRequestReading
        .clauses(input.text, input.context)
        .some(
            (clause) => !input.removalClauseStarts.has(clause.start) && refinementFigure.comparative(clause) !== null
        );
}

/**
 * How a refinement's own text reads against the pending card it refines: what it removes, whether its
 * clauses combine into one value clause per pending command, the comparative it states on its own or
 * beside a figure, and the value each of its clauses binds to a pending command.
 */
export const refinementClauseReader = {
    removals: readRefinementRemovals,
    combination: readClauseCombination,
    comparative: readRefinementComparative,
    figureComparative: statesFigureComparative,
    values: bindRefinementValues,
    unreadNegation: askUnreadNegation,
    additions: readAdditionClauses,
} as const;
