import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis, type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

import {
    bindRefinementFigure,
    refinementFigure,
    type BoundRefinementValue,
    type RefinementClause,
} from './bindRefinementFigure';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences, reservedVcaGroupReferenceWords } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { type PromptClause } from './groundingStrategies/promptScope';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';

type ProtectedObject = ProposalGroundingBasis['protectedUnchanged'][number];

/** A named object of the open project, and every object id the name can denote. */
type ReferenceCandidate = { name: string; denotes: ReadonlySet<string> };

type ClauseReference = { start: number; end: number; denotes: ReadonlySet<string> };

type CommandView = { index: number; command: ProposalGroundingCommand; denotes: ReadonlySet<string> };

/**
 * What a refinement removes from the pending card. A removal names one object of that card in whole,
 * after its article and an optional operation word; a name merely contained in the phrase never
 * counts. A negation removes only in the form `not`/`except`/`except for`/`without` [the] <object>
 * [operation word]: naming a pending object it removes that object's changes (of the operation the
 * word states), naming a project object outside the card it protects that object. Any other negated
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
          /** Clauses that ask for something the pending card does not carry; a new command must answer each. */
          additionClauses: RefinementClause[];
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
};

type RemovalClauseRead =
    | { kind: 'none' }
    | { kind: 'read' }
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
const REMOVAL = /^(?:drop|leave\s+out)\s+(.+)$/u;
const LEAVE_ALONE = /^leave\s+(.+?)\s+alone$/u;
const PROTECTION = /\b(?:leave|leaving|keep|keeping|preserve|preserving)\b.*\bunchanged\b/u;
const INNER_REMOVAL_SEPARATOR = /\s+(?=(?:except(?:\s+for)?|without)\s)/giu;
const REFERENCE_ARTICLES = /^(?:(?:the|a|an|my|its|their)\s+)+/u;
const REFERENCE_TRAILERS =
    /\s+(?:from\s+(?:the\s+|this\s+|that\s+)?(?:pending\s+)?(?:proposal|card|change|batch|list)|from\s+it|too|as\s+well|please)$/u;
const OPERATION_WORDS: Readonly<Record<string, readonly string[]>> = {
    pan: ['setTrackPan'],
    panning: ['setTrackPan'],
    gain: ['setTrackGain'],
    volume: ['setTrackGain'],
    level: ['setTrackGain'],
    fader: ['setTrackGain'],
    mute: ['muteTrack'],
    solo: ['soloTrack'],
};
const GENERIC_REFERENCE_NOUNS = /\s+(?:track|channel|bus|change|one)$/u;

/** The refinement's clauses: the shared clause splitter, then any trailing `except`/`without` phrase on its own. */
function readClauseSpans(text: string, context: ProjectContext): RefinementClause[] {
    const masked = maskQuotedLabels(maskProjectReferences(text, context));
    return getPromptClauses(text, masked).flatMap((clause) => {
        const cuts = Array.from(clause.masked.matchAll(INNER_REMOVAL_SEPARATOR), (match) => match.index);
        const bounds = [0, ...cuts, clause.masked.length];
        return bounds.slice(0, -1).flatMap((from, index) => {
            const to = bounds[index + 1]!;
            const piece = clause.text.slice(from, to);
            if (piece.trim().length === 0) {
                return [];
            }
            return [
                {
                    start: clause.start + from,
                    end: clause.start + to,
                    text: piece,
                    masked: clause.masked.slice(from, to),
                },
            ];
        });
    });
}

function normalizedClause(clause: PromptClause): string {
    return normalizePromptText(clause.text).replace(LEADING_CONNECTOR, '');
}

/**
 * Every object text the clause masking hides, and what each denotes: VCA groups, tracks, devices,
 * their parameters and clips, each by its id and its name. A clause naming one of them names an
 * object, so no name the masking keeps out of a clause's words can leave the clause unscoped.
 */
function collectReferenceCandidates(context: ProjectContext): ReferenceCandidate[] {
    const byName = new Map<string, Set<string>>();
    const add = (name: string | undefined, id: string) => {
        const normalized = normalizePromptText(name ?? '');
        if (normalized.length === 0) {
            return;
        }
        const ids = byName.get(normalized) ?? new Set<string>();
        ids.add(id);
        byName.set(normalized, ids);
    };
    for (const group of context.vcaGroups ?? []) {
        for (const reference of [group.id, group.name]) {
            if (!reservedVcaGroupReferenceWords.has(normalizePromptText(reference))) {
                add(reference, group.id);
            }
        }
    }
    for (const track of context.tracks) {
        add(track.id, track.id);
        add(track.name, track.id);
        for (const device of track.devices) {
            add(device.id, device.id);
            add(device.type, device.id);
            add(device.name, device.id);
            for (const parameter of device.parameters ?? []) {
                add(parameter.id, `${device.id}:${parameter.id}`);
                add(parameter.name, `${device.id}:${parameter.id}`);
            }
        }
        for (const clip of track.clips) {
            add(clip.id, clip.id);
            add(clip.name, clip.id);
        }
    }
    return Array.from(byName, ([name, denotes]) => ({ name, denotes })).sort(
        (left, right) => right.name.length - left.name.length
    );
}

/** Every whole-word project name a clause states, longest first, one reference per stretch of text. */
function findReferences(clauseText: string, candidates: readonly ReferenceCandidate[]): ClauseReference[] {
    const references: ClauseReference[] = [];
    for (const candidate of candidates) {
        const name = candidate.name.split(' ').map(escapeRegExp).join('[^\\p{L}\\p{N}]+');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'giu');
        for (const match of clauseText.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            if (references.some((reference) => start < reference.end && end > reference.start)) {
                continue;
            }
            references.push({ start, end, denotes: candidate.denotes });
        }
    }
    return references.sort((left, right) => left.start - right.start);
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

function stripReference(reference: string): { name: string; operations: readonly string[] | null } {
    let name = reference.replace(REFERENCE_TRAILERS, '').replace(REFERENCE_ARTICLES, '').trim();
    let operations: readonly string[] | null = null;
    const lastWord = name.split(' ').at(-1) ?? '';
    if (OPERATION_WORDS[lastWord] !== undefined && name.includes(' ')) {
        operations = OPERATION_WORDS[lastWord];
        name = name.slice(0, name.length - lastWord.length).trim();
    }
    return { name: name.replace(GENERIC_REFERENCE_NOUNS, '').trim(), operations };
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
    if (!statesFigure && findReferences(clause.text, candidates).length === 0) {
        return { kind: 'unread-negation' };
    }
    return {
        kind: 'clarify',
        question: `"${clause.text.trim()}" says what not to do. Name the pending change to remove, as in "not the snare", or say what it should be instead.`,
    };
}

function readRemovalClause(input: RemovalClauseInput): RemovalClauseRead {
    const { clause, candidates } = input;
    const text = normalizedClause(clause);
    const negation = NEGATION_FORM.exec(text);
    if (negation === null && NEGATION_WORD.test(normalizePromptText(clause.masked))) {
        return readOtherNegation(clause, candidates);
    }
    const alone = LEAVE_ALONE.exec(text);
    const stated = (negation ?? alone ?? REMOVAL.exec(text))?.[1];
    const statesFigure = findPromptNumbers(clause.masked).length > 0;
    if (stated === undefined || (statesFigure && negation === null)) {
        return { kind: 'none' };
    }
    const reference = stripReference(stated);
    const candidate = statesFigure ? undefined : candidates.find((entry) => entry.name === reference.name);
    if (candidate === undefined) {
        if (negation !== null) {
            return readOtherNegation(clause, candidates);
        }
        return { kind: 'refused', reason: describeUnresolvedRemoval(stated, 'object') };
    }
    return removeNamedObject(input, { stated, reference, candidate, protects: alone !== null || negation !== null });
}

/**
 * Remove the pending changes on the one object a removal names in whole, or protect the object it
 * names off the card when the removal is a negation or a "leave ... alone".
 */
function removeNamedObject(
    input: RemovalClauseInput,
    named: {
        stated: string;
        reference: ReturnType<typeof stripReference>;
        candidate: ReferenceCandidate;
        protects: boolean;
    }
): RemovalClauseRead {
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
    const candidates = collectReferenceCandidates(input.context);
    const removed = new Set<number>();
    const removedTargets: ProtectedObject[] = [];
    const protectedTargets: ProtectedObject[] = [];
    const removalClauseStarts = new Set<number>();
    const unreadNegations: RefinementClause[] = [];
    for (const clause of readClauseSpans(input.text, input.context)) {
        const outcome = readRemovalClause({
            clause,
            commands,
            candidates,
            context: input.context,
            removed,
            removedTargets,
            protectedTargets,
        });
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
    const references = findReferences(clause.text, candidates);
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
        context,
    });
}

/**
 * Whether the refinement's clauses combine into values one clause each states. A refinement binds a
 * pending command's value from at most one clause: a figure, direction or unit for the same command
 * in two clauses ("turn Vocals up, make it 2 dB", "make it 2 dB, Vocals louder") is asked, whichever
 * comes first, rather than read as one value. A clause stating a direction or unit with no figure
 * restates its command only in the direction that command already takes, and is asked otherwise.
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
    const scopeInput: ClauseScopeInput = {
        commands: viewCommands(input.basis, input.context),
        removedCommandIndexes: input.removedCommandIndexes,
        candidates: collectReferenceCandidates(input.context),
        catalog: getExecutableAppActionGroundingCatalog(),
    };
    const stating = new Set<number>();
    for (const clause of readClauseSpans(input.text, input.context)) {
        if (input.removalClauseStarts.has(clause.start) || !refinementFigure.statesValue(clause)) {
            continue;
        }
        const scope = readClauseScope(clause, scopeInput);
        if (scope.kind !== 'scoped') {
            continue;
        }
        for (const view of scope.meant.filter((meant) =>
            refinementFigure.canMean(clause, meant.command, input.context)
        )) {
            const restated = refinementFigure.restatementQuestion(clause, view.command);
            if (restated !== null) {
                return restated;
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
        readClauseSpans(text, context).flatMap((clause): Array<'less' | 'more'> => {
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
 * is an addition that a new command must answer. A negation naming no object ("not less", "not as
 * much") says something about the value no clause binds, so beside a bound value it is asked.
 */
function bindRefinementValues(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
    unreadNegations: readonly RefinementClause[];
}): RefinementValueBinding {
    const scopeInput: ClauseScopeInput = {
        commands: viewCommands(input.basis, input.context),
        removedCommandIndexes: input.removedCommandIndexes,
        candidates: collectReferenceCandidates(input.context),
        catalog: getExecutableAppActionGroundingCatalog(),
    };
    const values = new Map<number, BoundRefinementValue>();
    const additionClauses: RefinementClause[] = [];
    let comparative: 'less' | 'more' | null = null;
    for (const clause of readClauseSpans(input.text, input.context)) {
        if (input.removalClauseStarts.has(clause.start)) {
            continue;
        }
        const read = readValueClause(clause, scopeInput, input.context);
        switch (read.kind) {
            case 'consumed':
            case 'restated':
                break;
            case 'comparative':
                if (comparative !== null && comparative !== read.comparative) {
                    return { status: 'clarify', reason: OPEN_VALUE_REASON, question: 'Less or more?' };
                }
                comparative = read.comparative;
                break;
            case 'addition':
                additionClauses.push(clause);
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
    const [unreadNegation] = input.unreadNegations;
    if (unreadNegation !== undefined && (values.size > 0 || comparative !== null)) {
        const question = `"${unreadNegation.text.trim()}" does not say what the value should be. State the new value alone, for example "make it 1.5 dB".`;
        return { status: 'clarify', reason: OPEN_VALUE_REASON, question };
    }
    if (comparative !== null && values.size === 0) {
        const question = `How much ${comparative}? State the new value, for example "${comparative}, make it 1.5 dB".`;
        return { status: 'clarify', reason: OPEN_VALUE_REASON, question };
    }
    return { status: 'bound', values, additionClauses, comparative };
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
    return readClauseSpans(input.text, input.context).some(
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
} as const;
