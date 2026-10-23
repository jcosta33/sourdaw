import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis } from '../../models/ProposalGroundingBasis';

import {
    bindRefinementFigure,
    refinementFigure,
    type BoundRefinementValue,
    type RefinementClause,
} from './bindRefinementFigure';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { refinementActionWords } from './refinementActionWords';
import { refinementCardCommands, type CommandView } from './refinementCardCommands';
import { refinementCourtesy } from './refinementCourtesy';
import { refinementRemovalReading } from './refinementRemovalReading';
import { refinementRequestReading, type ReferenceCandidate } from './refinementRequestReading';

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

const OPEN_VALUE_REASON = 'The refinement leaves part of the change it asks for open.';
const COMPARATIVE =
    /^(?:(?:make it|go|do it)\s+)?(?:(?:a\s+)?(?:bit|little|touch|tad|lot)\s+|slightly\s+|much\s+|even\s+)?(less|more)(?:\s+please)?$/u;
const RESTRICTED_ADDITION_REASON = 'The refinement adds a change without saying whether the pending changes stay.';
/**
 * The closed restriction and replacement words an addition is asked for, in normalized words with
 * object names masked: each may say the addition stands in place of the pending changes.
 */
const RESTRICTION_WORDS = /(?:^|\s)(?:only|just|alone|instead|exclusively|rather|solely|in\s+place)(?:\s|$)/u;

const normalizedClause = refinementRequestReading.clauseWords;

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
    const restricted = findRestrictedAddition(input);
    if (restricted !== null) {
        return { status: 'clarify', reason: RESTRICTED_ADDITION_REASON, question: restricted };
    }
    const question = findClauseCombinationQuestion(input);
    return question === null ? { status: 'read' } : { status: 'clarify', reason: OPEN_VALUE_REASON, question };
}

/** Whether a clause's words, object names masked, hold a restriction or replacement word. */
function statesRestriction(clause: RefinementClause): boolean {
    return RESTRICTION_WORDS.test(normalizePromptText(clause.masked));
}

/**
 * An addition beside the pending card adds to it, so one stating a restriction or replacement word
 * ("mute Bass instead", "turn Snare down 2 dB only"), or standing beside a clause that is exactly
 * `instead` ("mute Bass, instead"), may mean the pending changes go, which no reading can tell from
 * an addition kept beside them: it is asked, as a restatement in such words is.
 */
function findRestrictedAddition(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
}): string | null {
    const scopeInput = createClauseScopeInput(input);
    const clauses = refinementRequestReading
        .clauses(input.text, input.context)
        .filter((clause) => !input.removalClauseStarts.has(clause.start));
    const additions = clauses.filter((clause) => readClauseScope(clause, scopeInput).kind === 'addition');
    const [first] = additions;
    if (first === undefined) {
        return null;
    }
    const restricted =
        additions.find(statesRestriction) ??
        (clauses.some((clause) => normalizedClause(clause) === 'instead') ? first : undefined);
    if (restricted === undefined) {
        return null;
    }
    return `"${restricted.text.trim()}" adds a change and says it replaces or restricts the pending ones. Say whether the pending changes stay beside it, or name each one to remove, as in "remove the snare".`;
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
            reason: refinementRemovalReading.negatedClauseReason,
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
    return refinementCourtesy.clauses.has(
        refinementRequestReading.withoutLeadingConnectors(normalizePromptText(clause.masked))
    );
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
    removals: refinementRemovalReading.read,
    combination: readClauseCombination,
    comparative: readRefinementComparative,
    figureComparative: statesFigureComparative,
    values: bindRefinementValues,
    unreadNegation: askUnreadNegation,
    additions: readAdditionClauses,
} as const;
