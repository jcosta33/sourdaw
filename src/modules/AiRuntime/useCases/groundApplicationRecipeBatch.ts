import { digest } from '#/utils/canonicalDigest';

import { type CreativeRequestAuthority, getCreativeSelectionSnapshot } from '../models/CreativeInterpretation';
import { type ProjectContext } from '../models/ProjectContext';
import { type AdoptedRecipe, type RetainedCompilation } from '../models/RetainedCompilation';

import { expandMixRecipe } from './expandMixRecipe';
import { getCompiledTransformTargetIds } from './getCompiledTransformTargetIds';
import { groundCompiledCommandBatch } from './groundCompiledCommandBatch';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';

/** One recipe the application chose to expand on one track; `role` is a role argued for that track, if any. */
type ApplicationRecipePair = { recipeId: string; targetId: string; role: string | null };

type GroundedBatch = Extract<ReturnType<typeof groundCompiledCommandBatch>, { status: 'grounded' }>;

type GroundApplicationRecipeBatchResult =
    | { status: 'refused-expansion'; pair: ApplicationRecipePair; reason: string }
    | { status: 'rejected'; reason: string }
    | { status: 'not-compiled' }
    | {
          status: 'grounded';
          grounded: GroundedBatch;
          adoptedRecipes: AdoptedRecipe[];
          creativeAuthority: CreativeRequestAuthority;
      };

type ExpandedPair = { pair: ApplicationRecipePair; compilation: Extract<RetainedCompilation, { kind: 'recipe' }> };

/** The devices each listed target gains, in the order the targets are first listed. */
function countAddedDevicesByTarget(expansions: readonly ExpandedPair[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const { pair, compilation } of expansions) {
        const added = compilation.commands.filter((command) => command.operation === 'addDevice').length;
        counts.set(pair.targetId, (counts.get(pair.targetId) ?? 0) + added);
    }
    return counts;
}

/**
 * What the application delegates by choosing these recipes itself: processing on exactly the listed
 * tracks, with room on each for exactly the devices its expansions add and nothing else. The
 * application states that delegation rather than asking a provider to interpret it; grounding then
 * holds every command to it as it holds any admitted creative authority.
 */
function applicationRecipeAuthority(input: {
    origin: string;
    expansions: readonly ExpandedPair[];
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
}): CreativeRequestAuthority {
    const requestDigest = digest(input.prompt.trim());
    const devicesByTarget = countAddedDevicesByTarget(input.expansions);
    const pairs = input.expansions.map(({ pair }) => ({ recipeId: pair.recipeId, targetId: pair.targetId }));
    return {
        schemaVersion: 1,
        authorityId: `${input.origin}-authority-${crypto.randomUUID()}`,
        catalogId: `${input.origin}-${digest({ requestDigest, revision: input.projectRevision, pairs }).slice(0, 16)}`,
        requestDigest,
        revision: input.projectRevision,
        selection: getCreativeSelectionSnapshot(input.context),
        mode: 'edit',
        targets: [
            {
                provenance: 'explicit-reference',
                objectType: 'track',
                objectIds: [...devicesByTarget.keys()],
                parentTrackId: null,
            },
        ],
        editDimensions: ['processing'],
        prohibitions: [],
        creationSlots: Array.from(devicesByTarget, ([targetId, budget]) => ({
            objectType: 'device' as const,
            parentObjectId: targetId,
            budget,
        })),
        uncertainty: 'none',
    };
}

/**
 * Expands recipes the application itself chose, each on its own track with no values (the middle of
 * each authored window, exactly as `recipe.expand` lowers it), and grounds the expansions as one batch
 * adopting them: through the bridge's compilation proof, runtime validation, state guards and the
 * production brief, asking no provider. Each pair expands under its own ordinal, so the device
 * bindings two expansions mint never collide. A pair that does not expand refuses the whole batch with
 * the expander's reason; the batch is never shrunk to the pairs that did.
 */
export function groundApplicationRecipeBatch(input: {
    /** Names the authority, catalog and retained compilations, so a batch's origin stays legible. */
    origin: string;
    pairs: readonly [ApplicationRecipePair, ...ApplicationRecipePair[]];
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
}): GroundApplicationRecipeBatchResult {
    const { context, projectRevision } = input;
    const expansions: ExpandedPair[] = [];
    for (const [ordinal, pair] of input.pairs.entries()) {
        const expanded = expandMixRecipe(
            { recipeId: pair.recipeId, targetId: pair.targetId, role: pair.role, values: [] },
            context,
            ordinal
        );
        if (expanded.status === 'refused') {
            return { status: 'refused-expansion', pair, reason: expanded.reason };
        }
        expansions.push({
            pair,
            compilation: {
                kind: 'recipe',
                callId: `${input.origin}-${String(ordinal)}`,
                revision: projectRevision,
                commands: expanded.commands,
                recipe: expanded.recipe,
            },
        });
    }
    const creativeAuthority = applicationRecipeAuthority({ ...input, expansions });
    const compilations = expansions.map(({ compilation }) => compilation);
    const transformCommands = materializeTransformToolCalls(compilations);
    const grounded = groundCompiledCommandBatch({
        toolCalls: transformCommands,
        context,
        prompt: input.prompt,
        projectRevision,
        workflowCapabilityId: undefined,
        compilerEvidence: undefined,
        selectedCompilations: compilations,
        transformCommands,
        transformTargetIds: getCompiledTransformTargetIds(transformCommands, context),
        creativeAuthority,
        providerProposal: null,
    });
    if (grounded.status === 'rejected') {
        return { status: 'rejected', reason: grounded.rejectionReason };
    }
    if (grounded.status !== 'grounded') {
        return { status: 'not-compiled' };
    }
    return {
        status: 'grounded',
        grounded,
        adoptedRecipes: compilations.map((compilation) => compilation.recipe),
        creativeAuthority,
    };
}
