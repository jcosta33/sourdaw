import { digest } from '#/utils/canonicalDigest';

import { type CreativeRequestAuthority, getCreativeSelectionSnapshot } from '../models/CreativeInterpretation';
import { type AnswerSuggestion } from '../models/PlanningOutcome';
import { type ProjectContext } from '../models/ProjectContext';
import { type AdoptedRecipe, type RetainedCompilation } from '../models/RetainedCompilation';
import { type ThreadContext } from '../models/ThreadContext';

import { expandMixRecipe } from './expandMixRecipe';
import { getCompiledTransformTargetIds } from './getCompiledTransformTargetIds';
import { groundCompiledCommandBatch } from './groundCompiledCommandBatch';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';

type GroundedBatch = Extract<ReturnType<typeof groundCompiledCommandBatch>, { status: 'grounded' }>;

type PlanAnswerSuggestionResult =
    | { status: 'refused'; reason: string }
    | {
          status: 'grounded';
          grounded: GroundedBatch;
          adoptedRecipe: AdoptedRecipe;
          creativeAuthority: CreativeRequestAuthority;
      };

/** The call id the one expansion is retained under; nothing outside this batch ever reads it. */
const SUGGESTION_COMPILATION_CALL_ID = 'answer-suggestion';

/**
 * What the user delegated by choosing the offer: processing on the one track the offer named, with
 * room for exactly the devices the expansion adds and nothing else. The offer's recipe and target are
 * what the request means, so the application states that delegation itself rather than asking a
 * provider to interpret "Propose this"; grounding then holds every command to it as it holds any
 * admitted creative authority.
 */
function suggestionAuthority(input: {
    suggestion: AnswerSuggestion;
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
    deviceCount: number;
}): CreativeRequestAuthority {
    const requestDigest = digest(input.prompt.trim());
    return {
        schemaVersion: 1,
        authorityId: `answer-suggestion-authority-${crypto.randomUUID()}`,
        catalogId: `answer-suggestion-${digest({ requestDigest, revision: input.projectRevision, recipeId: input.suggestion.recipeId, targetId: input.suggestion.targetId }).slice(0, 16)}`,
        requestDigest,
        revision: input.projectRevision,
        selection: getCreativeSelectionSnapshot(input.context),
        mode: 'edit',
        targets: [
            {
                provenance: 'explicit-reference',
                objectType: 'track',
                objectIds: [input.suggestion.targetId],
                parentTrackId: null,
            },
        ],
        editDimensions: ['processing'],
        prohibitions: [],
        creationSlots: [{ objectType: 'device', parentObjectId: input.suggestion.targetId, budget: input.deviceCount }],
        uncertainty: 'none',
    };
}

/**
 * Compiles the suggestion an answer offered into the batch a proposal carries, without asking a
 * provider anything: the recipe is expanded against the live project with the middle of each authored
 * window, exactly as `recipe.expand` lowers it with no values, and the expansion is grounded as a
 * proposal adopting it is, through the bridge's compilation proof, runtime validation, state guards
 * and the production brief. The offer was made about one project read; the target is read again here,
 * so a track since removed, frozen or given another role is refused with the reason, never adapted.
 */
export function planAnswerSuggestion(input: {
    suggestion: AnswerSuggestion;
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
    thread: ThreadContext | null;
}): PlanAnswerSuggestionResult {
    const { suggestion, context, projectRevision } = input;
    if (input.thread !== null && input.thread.pendingProposal !== null) {
        return {
            status: 'refused',
            reason: 'A proposal is already waiting in this chat. Confirm or cancel it before proposing this suggestion.',
        };
    }
    if (!context.tracks.some((track) => track.id === suggestion.targetId)) {
        return {
            status: 'refused',
            reason: `The track “${suggestion.targetName}” is no longer in the project, so the suggestion cannot be prepared.`,
        };
    }
    const expanded = expandMixRecipe(
        {
            recipeId: suggestion.recipeId,
            targetId: suggestion.targetId,
            // A role discovery read from the target is read from the target again, so a changed role is refused.
            role: suggestion.roleSource === 'argument' ? suggestion.recipeRole : null,
            values: [],
        },
        context,
        0
    );
    if (expanded.status === 'refused') {
        return {
            status: 'refused',
            reason: `The suggestion cannot be prepared for “${suggestion.targetName}”: ${expanded.reason}`,
        };
    }
    const creativeAuthority = suggestionAuthority({
        suggestion,
        context,
        projectRevision,
        prompt: input.prompt,
        deviceCount: expanded.commands.filter((command) => command.operation === 'addDevice').length,
    });
    const compilation: RetainedCompilation = {
        kind: 'recipe',
        callId: SUGGESTION_COMPILATION_CALL_ID,
        revision: projectRevision,
        commands: expanded.commands,
        recipe: expanded.recipe,
    };
    const transformCommands = materializeTransformToolCalls([compilation]);
    const grounded = groundCompiledCommandBatch({
        toolCalls: transformCommands,
        context,
        prompt: input.prompt,
        projectRevision,
        workflowCapabilityId: undefined,
        compilerEvidence: undefined,
        selectedCompilations: [compilation],
        transformCommands,
        transformTargetIds: getCompiledTransformTargetIds(transformCommands, context),
        creativeAuthority,
        providerProposal: null,
    });
    if (grounded.status === 'rejected') {
        return { status: 'refused', reason: grounded.rejectionReason };
    }
    if (grounded.status !== 'grounded') {
        return { status: 'refused', reason: 'The suggestion did not compile to a change for this project.' };
    }
    return { status: 'grounded', grounded, adoptedRecipe: expanded.recipe, creativeAuthority };
}
