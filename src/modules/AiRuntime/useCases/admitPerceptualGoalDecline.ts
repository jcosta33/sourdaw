import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type CommandBatchDecline } from '../models/CommandBatchDecline';
import { type ProjectContext } from '../models/ProjectContext';
import { maskQuotedTextContents, scanPromptQuotedText } from '../transformers/promptParser/promptQuotedText';

import { findAgentReferenceNameSpans } from './agentReference/findAgentReferenceNameSpans';
import { findCoordinatedTrackLists } from './agentReference/findCoordinatedTrackLists';
import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { getPromptClauses } from './agentReference/groundingStrategies/getPromptClauses';
import { isExplicitCommandClause } from './agentReference/groundingStrategies/isExplicitCommandClause';
import { maskProjectReferences } from './agentReference/groundingStrategies/maskProjectReferences';
import { hasExplicitTrackSelection } from './agentReference/hasExplicitTrackSelection';
import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';
import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';
import { readExplicitProtections } from './agentReference/readExplicitProtections';
import { refinementCourtesy } from './agentReference/refinementCourtesy';
import { resolveAgentReference } from './agentReference/resolveAgentReference';
import { resolveWholeMember } from './agentReference/resolveWholeMember';
import { resolveWorkflowTrackIds } from './agentReference/resolveWorkflowTrackIds';
import { discoverMixRecipes } from './discoverMixRecipes';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type RecipeRole = MixRecipeCatalog['roles'][number];

/** What a perceptual request points at, read the way the planner's own context names objects. */
type PerceptualGoalTarget =
    | { kind: 'none' }
    | { kind: 'tie' }
    | { kind: 'track'; id: string; name: string; via: 'name' | 'selection' }
    | { kind: 'tracks'; ids: readonly string[]; names: readonly string[] }
    | { kind: 'role'; role: RecipeRole; ids: readonly string[] }
    | { kind: 'project' };

type BoundPerceptualGoalTarget = Extract<PerceptualGoalTarget, { kind: 'track' | 'tracks' | 'role' | 'project' }>;
type PerceptualGoal = { target: BoundPerceptualGoalTarget; terms: string[] };

export type PerceptualGoalDeclineAdmission = { status: 'admitted' } | { status: 'refused'; reason: string };

/** The complete scope phrases the project-wide `analysis.measure` scope answers to. */
const PROJECT_SCOPE_WORDS = /^(?:the )?(?:project|mix|song)$/u;

const ADMITTED: PerceptualGoalDeclineAdmission = { status: 'admitted' };

/** Every track name and literal id is blanked, so a reference to "Bright Keys" states no goal. */
function maskTrackNames(prompt: string, context: ProjectContext): string {
    const names = context.tracks.flatMap((track) => [track.name, track.id]);
    const original = maskQuotedTextContents(prompt);
    const spans = names.flatMap((name) => findAgentReferenceNameSpans(original, name, 'exact', names));
    const masked = original.split('');
    for (const span of spans) {
        for (let index = span.start; index < span.end; index += 1) {
            masked[index] = ' ';
        }
    }
    return masked.join('');
}

/**
 * The catalog's own descriptor terms the prompt states, longest phrase first so "less bright" is
 * read once, as `dark`'s term, and not again as `bright`.
 */
function readFirstPerceptualTerm(
    prompt: string,
    context: ProjectContext,
    catalog: MixRecipeCatalog
): { term: string; start: number; end: number } | null {
    const masked = maskTrackNames(prompt, context);
    const terms = catalog.descriptors
        .flatMap((descriptor) => catalog.descriptorTerms[descriptor])
        .toSorted((left, right) => right.length - left.length);
    let first: { term: string; start: number; end: number } | null = null;
    for (const term of terms) {
        const words = normalizeAgentReferenceText(term).split(' ').map(escapeRegExp).join('[\\s-]+');
        const match = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu').exec(masked);
        if (match !== null && (first === null || match.index < first.start)) {
            first = { term, start: match.index, end: match.index + match[0].length };
        }
    }
    return first;
}

function readRoleWords(role: RecipeRole): string[] {
    if (role === 'bass') {
        return ['bass', 'basses'];
    }
    if (role === 'bus') {
        return ['bus', 'buses'];
    }
    const singular = role.endsWith('s') ? role.slice(0, -1) : role;
    return [singular, `${singular}s`];
}

function readNamedRole(prompt: string, catalog: MixRecipeCatalog): RecipeRole | null {
    const normalized = normalizeAgentReferenceText(maskQuotedTextContents(prompt));
    const roles = catalog.roles.filter((role) =>
        readRoleWords(role).some((word) =>
            new RegExp(`^(?:the )?${escapeRegExp(word)}(?: tracks?)?$`, 'u').test(normalized)
        )
    );
    return roles.length === 1 ? roles[0]! : null;
}

/** Reads catalog role qualifiers on a reserved selection without changing quoted names or source offsets. */
function readSelectionReference(prompt: string, catalog: MixRecipeCatalog): { text: string; roles: RecipeRole[] } {
    const masked = maskQuotedTextContents(prompt);
    const roles = new Set<RecipeRole>();
    const ranges: Array<{ start: number; end: number }> = [];
    for (const role of catalog.roles) {
        for (const word of readRoleWords(role)) {
            const pattern = new RegExp(`\\b(selected|current|this)(\\s+)(${escapeRegExp(word)})\\s+track\\b`, 'giu');
            for (const match of masked.matchAll(pattern)) {
                const start = match.index + match[1]!.length + match[2]!.length;
                ranges.push({ start, end: start + match[3]!.length });
                roles.add(role);
            }
        }
    }
    const text = ranges.reduce(
        (original, { start, end }) => `${original.slice(0, start)}${' '.repeat(end - start)}${original.slice(end)}`,
        prompt
    );
    return { text, roles: [...roles] };
}

/** A whole leading courtesy clause cannot erase a quoted, named or selected project reference. */
function isLeadingCourtesyClause(
    clause: ReturnType<typeof getPromptClauses>[number],
    context: ProjectContext
): boolean {
    const words = normalizeAgentReferenceText(clause.text);
    if (!refinementCourtesy.filler.has(words) && !refinementCourtesy.clauses.has(words)) {
        return false;
    }
    if (clause.masked.includes('□') || hasExplicitTrackSelection(clause.text)) {
        return false;
    }
    const unquoted = maskQuotedTextContents(clause.text);
    return unquoted === clause.text && maskTrackNames(clause.text, context) === unquoted;
}

/** A complete coordinated list is the authority for every stated member, even when only one name resolved. */
function readCoordinatedTarget(
    prompt: string,
    context: ProjectContext,
    goalStart: number
): PerceptualGoalTarget | null {
    const clauses = getPromptClauses(prompt, maskProjectReferences(prompt, context));
    const lists = findCoordinatedTrackLists({
        prompt,
        context,
        capability: 'track',
        risk: 'broad-reversible',
        clauses,
    });
    for (const list of lists) {
        const lastMember = list.members.at(-1);
        if (
            list.memberIds === null ||
            list.firstClauseIndex !== 0 ||
            list.lastClauseIndex !== clauses.length - 1 ||
            list.lead.trim().length > 0 ||
            lastMember === undefined ||
            prompt.slice(lastMember.end, goalStart).trim().length > 0
        ) {
            continue;
        }
        return {
            kind: 'tracks',
            ids: list.memberIds,
            names: list.memberIds.map((id) => context.tracks.find((track) => track.id === id)!.name),
        };
    }
    return null;
}

/** Name and selection bind through the canonical resolver; incomplete explicit targets never fall back to a role. */
function readNamedTrack(prompt: string, context: ProjectContext, catalog: MixRecipeCatalog): PerceptualGoalTarget {
    const reference = readSelectionReference(prompt, catalog);
    const readsSelection = hasExplicitTrackSelection(reference.text);
    if (readsSelection) {
        if (
            !/^(?:the )?(?:selected|current|this) (?:(?:audio|midi|bus|folder) )?track$/u.test(
                normalizeAgentReferenceText(reference.text)
            )
        ) {
            return { kind: 'tie' };
        }
        const selected = context.tracks.find((track) => track.id === context.selectedTrackId);
        if (selected === undefined) {
            return { kind: 'tie' };
        }
        for (const role of reference.roles) {
            if (
                !resolveWorkflowTrackIds(context, 'perceptual-goal-role', { all: [{ roleFamily: role }] }).includes(
                    selected.id
                )
            ) {
                return { kind: 'tie' };
            }
        }
        const resolution = resolveAgentReference({
            prompt: reference.text,
            assertedId: selected.id,
            capability: 'track',
            context,
        });
        if (resolution.status !== 'resolved') {
            return { kind: 'tie' };
        }
        return { kind: 'track', id: selected.id, name: selected.name, via: 'selection' };
    }
    const forms = [prompt, prompt.replace(/^\s*(?:the|a|an)\s+/iu, '')];
    for (const memberText of forms) {
        const id = resolveWholeMember({ memberText, context, capability: 'track', risk: 'broad-reversible' });
        if (id !== null) {
            return { kind: 'track', id, name: context.tracks.find((track) => track.id === id)!.name, via: 'name' };
        }
        const words = normalizeAgentReferenceText(memberText);
        if (
            context.tracks.some((track) =>
                [track.name, track.id].some((name) => normalizeAgentReferenceText(name) === words)
            )
        ) {
            return { kind: 'tie' };
        }
    }
    return { kind: 'none' };
}

function readPerceptualGoalTarget(
    prompt: string,
    context: ProjectContext,
    catalog: MixRecipeCatalog,
    goalStart: number
): PerceptualGoalTarget {
    const targetText = prompt.slice(0, goalStart).trim();
    const named = readNamedTrack(targetText, context, catalog);
    if (named.kind !== 'none') {
        return named;
    }
    const coordinated = readCoordinatedTarget(prompt, context, goalStart);
    if (coordinated !== null) {
        return coordinated;
    }
    if (maskQuotedTextContents(targetText) !== targetText) {
        return { kind: 'none' };
    }
    const role = readNamedRole(targetText, catalog);
    if (role !== null) {
        const ids = resolveWorkflowTrackIds(context, 'perceptual-goal-role', {
            all: [{ roleFamily: role }],
        });
        return ids.length === 0 ? { kind: 'none' } : { kind: 'role', role, ids };
    }
    if (PROJECT_SCOPE_WORDS.test(normalizeAgentReferenceText(targetText))) {
        return { kind: 'project' };
    }
    return { kind: 'none' };
}

/** The canonical command head admits polite delegation; punctuation alone never decides intent. */
function readDelegatedGoalBody(text: string): string | null {
    if (!isExplicitCommandClause(text, [])) {
        return null;
    }
    const verb = /\bmake\b/iu.exec(maskQuotedTextContents(text));
    return verb === null ? null : text.slice(verb.index + verb[0].length);
}

/** Reads only complete target-and-goal units after canonical protection consumption. */
function readPerceptualGoals(
    prompt: string,
    context: ProjectContext,
    catalog: MixRecipeCatalog
): PerceptualGoal[] | null {
    const initialClauses = getPromptClauses(prompt, maskProjectReferences(prompt, context));
    const first = initialClauses.find((clause) => !isLeadingCourtesyClause(clause, context));
    if (first === undefined) {
        return null;
    }
    const body = readDelegatedGoalBody(prompt.slice(first.start));
    if (body === null) {
        return null;
    }
    const goals: PerceptualGoal[] = [];
    let start: number | null = null;
    for (const clause of getPromptClauses(body, maskProjectReferences(body, context))) {
        if (start === null && isLeadingCourtesyClause(clause, context)) {
            continue;
        }
        start ??= clause.start;
        if (readFirstPerceptualTerm(clause.text, context, catalog) === null) {
            continue;
        }
        let unit = body.slice(start, clause.end).trim();
        let term = readFirstPerceptualTerm(unit, context, catalog);
        if (term === null) {
            return null;
        }
        if (!/^[\s.!?]*$/u.test(unit.slice(term.end))) {
            return null;
        }
        if (unit.slice(0, term.start).trim().length === 0) {
            const previous = goals.at(-1);
            if (previous === undefined) {
                return null;
            }
            previous.terms.push(term.term);
            start = null;
            continue;
        }
        let target = readPerceptualGoalTarget(unit, context, catalog, term.start);
        if (target.kind === 'none') {
            const delegated = readDelegatedGoalBody(unit);
            if (delegated !== null) {
                unit = delegated.trim();
                term = readFirstPerceptualTerm(unit, context, catalog);
                if (term === null || unit.slice(0, term.start).trim().length === 0) {
                    return null;
                }
                target = readPerceptualGoalTarget(unit, context, catalog, term.start);
            }
        }
        if (target.kind === 'none' || target.kind === 'tie') {
            return null;
        }
        goals.push({ target, terms: [term.term] });
        start = null;
    }
    return start === null && goals.length > 0 ? goals : null;
}

/** Eligibility omits only proven protection spans; the planner keeps the untouched request. */
function maskResolvedProtectionClauses(prompt: string, context: ProjectContext): string | null {
    const protections = readExplicitProtections(prompt, context, { requireUniqueTrackOwners: true });
    if (protections.unresolved.length > 0) {
        return null;
    }
    const masked = prompt.split('');
    for (const { start, end } of protections.resolvedTrackClauses) {
        for (let index = start; index < end; index += 1) {
            masked[index] = ' ';
        }
    }
    return masked.join('');
}

function describeTarget(
    target: Extract<PerceptualGoalTarget, { kind: 'track' | 'tracks' | 'role' | 'project' }>
): string {
    switch (target.kind) {
        case 'track':
            return `the ${target.via === 'selection' ? 'selected track' : 'track'} "${target.name}" (${target.id})`;
        case 'tracks':
            return `the tracks ${target.names.map((name) => JSON.stringify(name)).join(', ')}`;
        case 'role':
            return `the ${target.role} role (${String(target.ids.length)} track(s))`;
        case 'project':
            return 'the project scope';
        default: {
            const exhaustive: never = target;
            throw new Error(`Unsupported perceptual goal target: ${JSON.stringify(exhaustive)}`);
        }
    }
}

function answersGoal(
    target: Extract<PerceptualGoalTarget, { kind: 'track' | 'tracks' | 'role' | 'project' }>,
    terms: readonly string[],
    context: ProjectContext
): boolean {
    const role = target.kind === 'role' ? target.role : null;
    const answersTrackGoal = (id: string): boolean => {
        const track = context.tracks.find((candidate) => candidate.id === id);
        if (
            track === undefined ||
            track.frozen === true ||
            !isAgentReferenceCapabilityCandidate({ capability: 'device-host-track', context, id })
        ) {
            return false;
        }
        return terms.every((term) => {
            const discovery = discoverMixRecipes({ descriptors: [term], targetId: id, role, limit: 1 }, context.tracks);
            return discovery.status === 'ok' && discovery.data.total > 0;
        });
    };
    if (target.kind === 'project') {
        return context.tracks.some((track) => answersTrackGoal(track.id));
    }
    const ids = target.kind === 'track' ? [target.id] : target.ids;
    return ids.every(answersTrackGoal);
}

/**
 * A clarification is for a request the application cannot plan. A perceptual goal the recipe
 * catalog answers, aimed at a target the application resolves, is work to plan: measure, discover a
 * recipe, propose. So that decline is refused with the method to follow. A clarification still
 * stands when no target resolves, when a target reference is ambiguous, when no recipe answers
 * the goal for that target, and when the request states no goal the catalog's vocabulary reads.
 */
export function admitPerceptualGoalDecline(input: {
    decline: CommandBatchDecline;
    prompt: string;
    context: ProjectContext;
    unresolvedExplicitReferences: readonly string[];
}): PerceptualGoalDeclineAdmission {
    if (
        input.decline.kind !== 'clarify' ||
        input.unresolvedExplicitReferences.length > 0 ||
        !scanPromptQuotedText(input.prompt).complete
    ) {
        return ADMITTED;
    }
    const eligibilityPrompt = maskResolvedProtectionClauses(input.prompt, input.context);
    if (eligibilityPrompt === null) {
        return ADMITTED;
    }
    const catalog = getMixRecipeCatalog();
    const goals = readPerceptualGoals(eligibilityPrompt, input.context, catalog);
    if (goals === null || goals.some((goal) => !answersGoal(goal.target, goal.terms, input.context))) {
        return ADMITTED;
    }
    const descriptions = goals.map((goal) => `${goal.terms.join(', ')} for ${describeTarget(goal.target)}`);
    return {
        status: 'refused',
        reason: `The request delegates supported perceptual goals (${descriptions.join('; ')}), and recipe.discover answers each. Do not ask for clarification. Measure the scope with analysis.measure, find a recipe with recipe.discover, expand it with recipe.expand, then send command.batch.propose. Decline again only when a target stays unresolved or ambiguous, or no supported recipe answers the goal.`,
    };
}
