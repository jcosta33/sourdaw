import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis, type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

import { bindRefinementFigure, type BoundRefinementValue, type RefinementClause } from './bindRefinementFigure';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './groundingStrategies/maskProjectReferences';
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
 * counts, and a removal that names no pending object refuses the refinement.
 */
type RefinementRemovals =
    | { status: 'refused'; reason: string }
    | {
          status: 'read';
          removedCommandIndexes: ReadonlySet<number>;
          /** Objects whose every pending command the refinement removed; they stay unchanged. */
          removedTargets: ProtectedObject[];
          /** Objects outside the card the refinement asks to leave alone. */
          protectedTargets: ProtectedObject[];
          removalClauseStarts: ReadonlySet<number>;
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

type ClauseRead =
    | { kind: 'consumed' }
    | { kind: 'comparative'; comparative: 'less' | 'more' }
    | ReturnType<typeof bindRefinementFigure>;

type RemovalClauseRead = { kind: 'none' } | { kind: 'read' } | { kind: 'refused'; reason: string };

const OPEN_VALUE_REASON = 'The refinement leaves part of the change it asks for open.';
const LEADING_CONNECTOR = /^(?:(?:and|but|also|then|just|please|ok|okay)\s+)+/u;
const FILLER_CLAUSES: ReadonlySet<string> = new Set(['please', 'thanks', 'thank you', 'ok', 'okay', 'instead']);
const COMPARATIVE =
    /^(?:(?:make it|go|do it)\s+)?(?:(?:a\s+)?(?:bit|little|touch|tad|lot)\s+|slightly\s+|much\s+|even\s+)?(less|more)(?:\s+please)?$/u;
const REMOVAL = /^(?:not|except(?:\s+for)?|without|drop|leave\s+out)\s+(.+)$/u;
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
    for (const track of context.tracks) {
        add(track.name, track.id);
        for (const device of track.devices) {
            add(device.type, device.id);
            add(device.name, device.id);
            for (const parameter of device.parameters ?? []) {
                add(parameter.name, `${device.id}:${parameter.id}`);
            }
        }
        for (const clip of track.clips) {
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
    return context.tracks.find((track) => track.id === id)?.name ?? id;
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

function readRemovalClause(input: {
    clause: RefinementClause;
    commands: readonly CommandView[];
    candidates: readonly ReferenceCandidate[];
    context: ProjectContext;
    removed: Set<number>;
    removedTargets: ProtectedObject[];
    protectedTargets: ProtectedObject[];
}): RemovalClauseRead {
    const { clause, commands, candidates, context } = input;
    if (findPromptNumbers(clause.masked).length > 0) {
        return { kind: 'none' };
    }
    const text = normalizedClause(clause);
    const alone = LEAVE_ALONE.exec(text);
    const removal = alone ?? REMOVAL.exec(text);
    const stated = removal?.[1];
    if (stated === undefined) {
        return { kind: 'none' };
    }
    const reference = stripReference(stated);
    const candidate = candidates.find((entry) => entry.name === reference.name);
    if (candidate === undefined) {
        return { kind: 'refused', reason: describeUnresolvedRemoval(stated, 'object') };
    }
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
            alone !== null &&
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
        removalClauseStarts.add(clause.start);
    }
    return { status: 'read', removedCommandIndexes: removed, removedTargets, protectedTargets, removalClauseStarts };
}

function readValueClause(input: {
    clause: RefinementClause;
    commands: readonly CommandView[];
    removedCommandIndexes: ReadonlySet<number>;
    candidates: readonly ReferenceCandidate[];
    context: ProjectContext;
    catalog: ReturnType<typeof getExecutableAppActionGroundingCatalog>;
}): ClauseRead {
    const { clause, commands, candidates } = input;
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
    return bindRefinementFigure({
        clause,
        scoped: meant.filter((view) => !input.removedCommandIndexes.has(view.index)),
        removed: meant.filter((view) => input.removedCommandIndexes.has(view.index)),
        namesObjects: references.length > 0,
        statesAction: intent !== null,
        context: input.context,
    });
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
 * pending value of the stated unit when it names none. Anything a clause leaves open — which command,
 * which unit, which way — is asked rather than guessed, and a clause naming an object outside the card
 * is an addition that a new command must answer.
 */
function bindRefinementValues(input: {
    text: string;
    basis: ProposalGroundingBasis;
    context: ProjectContext;
    removalClauseStarts: ReadonlySet<number>;
    removedCommandIndexes: ReadonlySet<number>;
}): RefinementValueBinding {
    const commands = viewCommands(input.basis, input.context);
    const candidates = collectReferenceCandidates(input.context);
    const catalog = getExecutableAppActionGroundingCatalog();
    const values = new Map<number, BoundRefinementValue>();
    const additionClauses: RefinementClause[] = [];
    let comparative: 'less' | 'more' | null = null;
    for (const clause of readClauseSpans(input.text, input.context)) {
        if (input.removalClauseStarts.has(clause.start)) {
            continue;
        }
        const read = readValueClause({
            clause,
            commands,
            removedCommandIndexes: input.removedCommandIndexes,
            candidates,
            context: input.context,
            catalog,
        });
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
                if (values.has(read.index)) {
                    return {
                        status: 'clarify',
                        reason: OPEN_VALUE_REASON,
                        question: 'The refinement states two values for one pending change. Which one do you mean?',
                    };
                }
                values.set(read.index, read.value);
                break;
            case 'clarify':
                return { status: 'clarify', reason: OPEN_VALUE_REASON, question: read.question };
            case 'refused':
                return { status: 'refused', reason: read.reason };
        }
    }
    if (comparative !== null && values.size === 0) {
        const question = `How much ${comparative}? State the new value, for example "${comparative}, make it 1.5 dB".`;
        return { status: 'clarify', reason: OPEN_VALUE_REASON, question };
    }
    return { status: 'bound', values, additionClauses, comparative };
}

/**
 * How a refinement's own text reads against the pending card it refines: what it removes, the
 * comparative it states, and the value each of its clauses binds to a pending command.
 */
export const refinementClauseReader = {
    removals: readRefinementRemovals,
    comparative: readRefinementComparative,
    values: bindRefinementValues,
} as const;
