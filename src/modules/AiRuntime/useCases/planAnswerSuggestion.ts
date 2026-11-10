import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type AnswerSuggestion } from '../models/PlanningOutcome';
import { type ProjectContext } from '../models/ProjectContext';
import { type AdoptedRecipe } from '../models/RetainedCompilation';
import { type ThreadContext } from '../models/ThreadContext';

import { groundApplicationRecipeBatch } from './groundApplicationRecipeBatch';

type GroundedBatch = Extract<ReturnType<typeof groundApplicationRecipeBatch>, { status: 'grounded' }>['grounded'];

type PlanAnswerSuggestionResult =
    | { status: 'refused'; reason: string }
    | {
          status: 'grounded';
          grounded: GroundedBatch;
          adoptedRecipe: AdoptedRecipe;
          creativeAuthority: CreativeRequestAuthority;
      };

/** Names the authority and the one retained expansion; nothing outside this batch ever reads it. */
const SUGGESTION_ORIGIN = 'answer-suggestion';

/**
 * Compiles the suggestion an answer offered into the batch a proposal carries, without asking a
 * provider anything: the one recipe is expanded on the one track the offer named and grounded as the
 * application's own recipe batch, under an authority limited to processing on that track with room
 * for exactly the devices the expansion adds. The offer was made about one project read; the target
 * is read again here, so a track since removed, frozen or given another role is refused with the
 * reason, never adapted.
 */
export function planAnswerSuggestion(input: {
    suggestion: AnswerSuggestion;
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
    thread: ThreadContext | null;
}): PlanAnswerSuggestionResult {
    const { suggestion, context } = input;
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
    const batch = groundApplicationRecipeBatch({
        origin: SUGGESTION_ORIGIN,
        pairs: [
            {
                recipeId: suggestion.recipeId,
                targetId: suggestion.targetId,
                // A role discovery read from the target is read from the target again, so a changed role is refused.
                role: suggestion.roleSource === 'argument' ? suggestion.recipeRole : null,
            },
        ],
        context,
        projectRevision: input.projectRevision,
        prompt: input.prompt,
    });
    switch (batch.status) {
        case 'refused-expansion':
            return {
                status: 'refused',
                reason: `The suggestion cannot be prepared for “${suggestion.targetName}”: ${batch.reason}`,
            };
        case 'rejected':
            return { status: 'refused', reason: batch.reason };
        case 'not-compiled':
            return { status: 'refused', reason: 'The suggestion did not compile to a change for this project.' };
        case 'grounded':
            return {
                status: 'grounded',
                grounded: batch.grounded,
                adoptedRecipe: batch.adoptedRecipes[0]!,
                creativeAuthority: batch.creativeAuthority,
            };
        default: {
            const exhaustive: never = batch;
            throw new Error(`Unsupported application recipe batch result: ${JSON.stringify(exhaustive)}`);
        }
    }
}
