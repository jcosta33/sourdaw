import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis, type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

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
import { refinementRequestReading, type ReferenceCandidate, type StatedReference } from './refinementRequestReading';

type ProtectedObject = ProposalGroundingBasis['protectedUnchanged'][number];

type CommandView = { index: number; command: ProposalGroundingCommand; denotes: ReadonlySet<string> };

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
 * read: filler or a protection it consumes, a comparative of its own, an addition naming an object no
 * pending command acts on, or the kept pending commands it can mean.
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
    | { kind: 'clarify'; question: string };

type RemovalClauseInput = {
    clause: RefinementClause;
    commands: readonly CommandView[];
    candidates: readonly ReferenceCandidate[];
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
const LEADING_CONNECTOR = /^(?:(?:and|but|also|then|just|please|ok|okay)\s+)+/u;
const FILLER_CLAUSES: ReadonlySet<string> = new Set(['please', 'thanks', 'thank you', 'ok', 'okay', 'instead']);
const COMPARATIVE =
    /^(?:(?:make it|go|do it)\s+)?(?:(?:a\s+)?(?:bit|little|touch|tad|lot)\s+|slightly\s+|much\s+|even\s+)?(less|more)(?:\s+please)?$/u;
/** The one form a negation removes or protects in: `not`/`except`/`except for`/`without` and what follows. */
const NEGATION_FORM = /^(?:not|except(?:\s+for)?|without)\s+(.+)$/u;
/** Any negation a clause states, read from its normalized words outside object names ("don't" reads "don t"). */
const NEGATION_WORD = /(?<![\p{L}\p{N}])(?:not|never|without|except|cannot|\p{L}*n t)(?![\p{L}\p{N}])/u;
const LEAVE_ALONE = /^leave\s+(.+?)\s+alone$/u;
const PROTECTION =
    /\b(?:leave|leaving|keep|keeping|preserve|preserving)\b.*\b(?:unchanged|as\s+(?:it\s+is|is|proposed))\b/u;

function normalizedClause(clause: PromptClause): string {
    return normalizePromptText(clause.text).replace(LEADING_CONNECTOR, '');
}

function findOwnerTrackId(context: ProjectContext, objectId: string): string | null {
    const owner = context.tracks.find(
        (track) =>
            track.devices.some((device) => device.id === objectId) || track.clips.some((clip) => clip.id === objectId)
    );
    return owner?.id ?? null;
}

/** Every object id a pending command acts on, its device parameter, and the track that owns it. */
function getCommandDenotation(command: ProposalGroundingCommand, context: ProjectContext): Set<string> {
    const ids = new Set<string>();
    const deviceId = command.targets.find((target) => target.argument === 'deviceId')?.id;
    for (const target of command.targets) {
        if (target.argument === 'paramId' && deviceId !== undefined) {
            ids.add(`${deviceId}:${target.id}`);
            continue;
        }
        ids.add(target.id);
        const owner = findOwnerTrackId(context, target.id);
        if (owner !== null) {
            ids.add(owner);
        }
    }
    return ids;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    for (const id of left) {
        if (right.has(id)) {
            return true;
        }
    }
    return false;
}

function nameObject(context: ProjectContext, id: string): string {
    return (
        context.tracks.find((track) => track.id === id)?.name ??
        context.vcaGroups?.find((group) => group.id === id)?.name ??
        id
    );
}

function viewCommands(basis: ProposalGroundingBasis, context: ProjectContext): CommandView[] {
    return basis.commands.map((command, index) => ({
        index,
        command,
        denotes: getCommandDenotation(command, context),
    }));
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
    const negation = NEGATION_FORM.exec(text);
    const alone = LEAVE_ALONE.exec(text);
    if ((negation !== null || alone !== null) && (input.continuesRemoval || input.precedesRemoval)) {
        return askNegationBesideRemoval(clause);
    }
    if (negation === null && NEGATION_WORD.test(normalizePromptText(clause.masked))) {
        return readOtherNegation(clause, candidates);
    }
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
            intersects(view.denotes, candidate.denotes) &&
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
            input.protectedTargets.push({ id: outsideId, name: nameObject(context, outsideId) });
            return { kind: 'read' };
        }
        return { kind: 'refused', reason: describeUnresolvedRemoval(stated, 'change') };
    }
    for (const view of onTarget) {
        input.removed.add(view.index);
    }
    if (reference.operations === null) {
        input.removedTargets.push({ id: pendingObjectId, name: nameObject(context, pendingObjectId) });
    }
    return { kind: 'read' };
}

/** Read every removal clause of a refinement against the pending card it refines. */
function readRefinementRemovals(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
}): RefinementRemovals {
    const commands = viewCommands(input.basis, input.context);
    const candidates = refinementRequestReading.candidates(input.context);
    const removed = new Set<number>();
    const removedTargets: ProtectedObject[] = [];
    const protectedTargets: ProtectedObject[] = [];
    const removalClauseStarts = new Set<number>();
    const unreadNegations: RefinementClause[] = [];
    let continuesRemoval = false;
    const clauses = refinementRequestReading.clauses(input.text, input.context);
    for (const [index, clause] of clauses.entries()) {
        const next = clauses[index + 1];
        const outcome = readRemovalClause({
            clause,
            commands,
            candidates,
            context: input.context,
            removed,
            removedTargets,
            protectedTargets,
            continuesRemoval,
            precedesRemoval: next !== undefined && refinementRequestReading.removalObject(next) !== null,
        });
        continuesRemoval = outcome.kind === 'read' && outcome.removes;
        if (outcome.kind === 'none') {
            continue;
        }
        if (outcome.kind === 'refused') {
            return { status: 'refused', reason: outcome.reason };
        }
        if (outcome.kind === 'clarify') {
            return { status: 'clarify', reason: NEGATED_CLAUSE_REASON, question: outcome.question };
        }
        if (outcome.kind === 'unread-negation') {
            unreadNegations.push(clause);
        }
        removalClauseStarts.add(clause.start);
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
 * states, or every kept command when it names none.
 */
function readClauseScope(clause: RefinementClause, input: ClauseScopeInput): ClauseScope {
    const { commands, candidates } = input;
    const text = normalizedClause(clause);
    if (text.length === 0 || FILLER_CLAUSES.has(text) || PROTECTION.test(text)) {
        return { kind: 'consumed' };
    }
    const comparative = COMPARATIVE.exec(text)?.[1];
    if (comparative === 'less' || comparative === 'more') {
        return { kind: 'comparative', comparative };
    }
    const references = refinementRequestReading.references(clause.text, candidates);
    const pendingIds = new Set(commands.flatMap((view) => Array.from(view.denotes)));
    if (references.some((reference) => !intersects(reference.denotes, pendingIds))) {
        return { kind: 'addition' };
    }
    const intent = resolveClauseActionIntent(clause.masked, input.catalog)?.actionType ?? null;
    const meant = commands.filter(
        (view) =>
            (intent === null || view.command.type === intent) &&
            (references.length === 0 || references.some((reference) => intersects(reference.denotes, view.denotes)))
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
                    .some((reference) => intersects(reference.denotes, view.denotes)) &&
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
    const commands = viewCommands(input.basis, input.context);
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
            });
            if (restated !== null) {
                return restated;
            }
            if (!statesValue) {
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
 * A negation naming no object ("not as much", "never mind", "not less") says something about a value
 * no clause binds. On its own it is read and left alone; beside a value the refinement binds or changes,
 * or a comparative it states, it is asked, whichever route grounded the batch: the inherited route asks
 * it while binding, and the final check every route passes asks it beside a pending value the batch
 * changes.
 */
function askUnreadNegation(input: {
    text: string;
    context: ProjectContext;
    unreadNegations: readonly RefinementClause[];
    bindsValue: boolean;
}): { reason: string; question: string } | null {
    const [unreadNegation] = input.unreadNegations;
    if (unreadNegation === undefined) {
        return null;
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
 * answer it. Removal clauses are read as removals, never as additions.
 */
function readAdditionClauses(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
}): RefinementClause[] {
    const scopeInput = createClauseScopeInput(input);
    return refinementRequestReading
        .clauses(input.text, input.context)
        .filter(
            (clause) =>
                !input.removalClauseStarts.has(clause.start) &&
                readValueClause(clause, scopeInput, input.context).kind === 'addition'
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
    removals: readRefinementRemovals,
    combination: readClauseCombination,
    comparative: readRefinementComparative,
    figureComparative: statesFigureComparative,
    values: bindRefinementValues,
    unreadNegation: askUnreadNegation,
    additions: readAdditionClauses,
} as const;
