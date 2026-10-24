import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type CommandBatchDecline } from '../models/CommandBatchDecline';
import { type ProjectContext } from '../models/ProjectContext';
import { maskQuotedTextContents, scanPromptQuotedText } from '../transformers/promptParser/promptQuotedText';

import { findAgentReferenceNameSpans } from './agentReference/findAgentReferenceNameSpans';
import { findCoordinatedTrackLists } from './agentReference/findCoordinatedTrackLists';
import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { getPromptClauses } from './agentReference/groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './agentReference/groundingStrategies/maskProjectReferences';
import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';
import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';
import { resolveAgentReference } from './agentReference/resolveAgentReference';
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

export type PerceptualGoalDeclineAdmission = { status: 'admitted' } | { status: 'refused'; reason: string };

/**
 * The scope words the project-wide `analysis.measure` scope answers to. A role or a track the prompt
 * names takes precedence, so a request naming both is read by the narrower one.
 */
const PROJECT_SCOPE_WORDS = /\b(?:project|mix|song)\b/u;

const ADMITTED: PerceptualGoalDeclineAdmission = { status: 'admitted' };

/** Every span a project track is named by, blanked, so a track called "Bright Keys" states no goal. */
function maskTrackNames(prompt: string, context: ProjectContext): string {
    const names = context.tracks.map((track) => track.name);
    let masked = maskQuotedTextContents(prompt);
    for (const name of names) {
        for (const span of findAgentReferenceNameSpans(masked, name, 'exact', names)) {
            masked = `${masked.slice(0, span.start)}${' '.repeat(span.end - span.start)}${masked.slice(span.end)}`;
        }
    }
    return masked;
}

/**
 * The catalog's own descriptor terms the prompt states, longest phrase first so "less bright" is
 * read once, as `dark`'s term, and not again as `bright`.
 */
function readPerceptualTerms(prompt: string, context: ProjectContext, catalog: MixRecipeCatalog): string[] {
    let remaining = ` ${normalizeAgentReferenceText(maskTrackNames(prompt, context))} `;
    const terms = catalog.descriptors
        .flatMap((descriptor) => catalog.descriptorTerms[descriptor])
        .toSorted((left, right) => right.length - left.length);
    const stated: string[] = [];
    for (const term of terms) {
        const needle = ` ${normalizeAgentReferenceText(term)} `;
        if (!remaining.includes(needle) || stated.includes(term)) {
            continue;
        }
        stated.push(term);
        remaining = remaining.replaceAll(needle, ' ');
    }
    return stated;
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

function readNamedRole(prompt: string, catalog: MixRecipeCatalog): RecipeRole | 'ambiguous' | null {
    const normalized = normalizeAgentReferenceText(maskQuotedTextContents(prompt));
    const roles = catalog.roles.filter((role) =>
        readRoleWords(role).some((word) =>
            new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'u').test(normalized)
        )
    );
    return roles.length > 1 ? 'ambiguous' : (roles[0] ?? null);
}

/**
 * Name and selection go through the grounding resolver the bridge binds provider targets with, so a
 * request this reads as one object is the object grounding would bind. A complete coordinated list
 * names all its members; alternatives and ambiguous members remain ties.
 */
function readNamedTrack(prompt: string, context: ProjectContext): PerceptualGoalTarget {
    const resolution = resolveAgentReference({ prompt, assertedId: null, capability: 'track', context });
    if (resolution.status === 'rejected' && resolution.reason === 'ambiguous-target') {
        const masked = maskProjectReferences(prompt, context);
        const lists = findCoordinatedTrackLists({
            prompt,
            context,
            capability: 'track',
            risk: 'broad-reversible',
            clauses: getPromptClauses(prompt, masked),
        });
        const candidateIds = resolution.candidates.map((candidate) => candidate.id);
        for (const list of lists) {
            if (
                list.memberIds === null ||
                list.memberNamedOutsideList ||
                !list.everyOtherClauseNamesAnotherTrack ||
                list.memberIds.length !== candidateIds.length ||
                !candidateIds.every((id) => list.memberIds?.includes(id))
            ) {
                continue;
            }
            return {
                kind: 'tracks',
                ids: list.memberIds,
                names: list.memberIds.map((id) => context.tracks.find((track) => track.id === id)!.name),
            };
        }
        return { kind: 'tie' };
    }
    if (resolution.status !== 'rejected' || resolution.reason !== 'asserted-target-mismatch') {
        return { kind: 'none' };
    }
    const named = resolution.candidates.filter((candidate) => !candidate.evidence.every((e) => e === 'fuzzy-name'));
    const only = named.length === 1 ? named[0] : undefined;
    if (only === undefined) {
        return { kind: 'none' };
    }
    return {
        kind: 'track',
        id: only.id,
        name: only.name,
        via: only.evidence.includes('selection') && !only.evidence.includes('exact-name') ? 'selection' : 'name',
    };
}

function readPerceptualGoalTarget(
    prompt: string,
    context: ProjectContext,
    catalog: MixRecipeCatalog
): PerceptualGoalTarget {
    const named = readNamedTrack(prompt, context);
    if (named.kind !== 'none') {
        return named;
    }
    const role = readNamedRole(prompt, catalog);
    if (role === 'ambiguous') {
        return { kind: 'tie' };
    }
    if (role !== null) {
        const ids = resolveWorkflowTrackIds(context, 'perceptual-goal-role', {
            all: [{ roleFamily: role }],
        });
        return ids.length === 0 ? { kind: 'none' } : { kind: 'role', role, ids };
    }
    if (PROJECT_SCOPE_WORDS.test(normalizeAgentReferenceText(maskQuotedTextContents(prompt)))) {
        return { kind: 'project' };
    }
    return { kind: 'none' };
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
    const catalog = getMixRecipeCatalog();
    const terms = readPerceptualTerms(input.prompt, input.context, catalog);
    if (terms.length === 0) {
        return ADMITTED;
    }
    const target = readPerceptualGoalTarget(input.prompt, input.context, catalog);
    if (target.kind === 'none' || target.kind === 'tie' || !answersGoal(target, terms, input.context)) {
        return ADMITTED;
    }
    return {
        status: 'refused',
        reason: `The request states a perceptual goal (${terms.join(', ')}) for ${describeTarget(target)}, and recipe.discover answers it. Do not ask for clarification. Measure the scope with analysis.measure, find a recipe with recipe.discover, expand it with recipe.expand, then send command.batch.propose. Decline again only when a target stays unresolved or ambiguous, or no supported recipe answers the goal.`,
    };
}
