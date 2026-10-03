import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { RECIPE_EXPANSION_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ProjectContext } from '../models/ProjectContext';
import { type AdoptedRecipe, type RetainedCommand, type RetainedCompilation } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { expandMixRecipe } from './expandMixRecipe';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';
import { parseRecipeExpansionInput } from './parseRecipeExpansionInput';

type RecipeExpansionResult = {
    receipt: ApplicationToolReceipt;
    commands: readonly RetainedCommand[] | null;
    recipe: AdoptedRecipe | null;
};

/**
 * One `recipe.expand` call as the loop sees it: a receipt, plus the commands and provenance the loop
 * retains by call id when the expansion succeeded. The receipt shows the commands through the same
 * materializer an adopting proposal uses, so the provider reads exactly what it will be adopting.
 * Every refusal is a retryable `invalid-tool-arguments` failure that names the problem, because each
 * is something the provider can correct with another call.
 */
export function executeRecipeExpansion(input: {
    call: ToolCallResult;
    callId: string;
    turn: number;
    ordinal: number;
    context: ProjectContext;
    revision: string;
}): RecipeExpansionResult {
    const { call, callId, turn, revision } = input;
    const failure = (reason: string): RecipeExpansionResult => ({
        commands: null,
        recipe: null,
        receipt: {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: RECIPE_EXPANSION_TOOL_NAME,
            turn,
            status: 'failure',
            revision,
            data: null,
            summary: reason,
            warnings: [],
            error: { code: 'invalid-tool-arguments', safeMessage: reason, retryable: true },
        },
    });
    const parsed = parseRecipeExpansionInput(call.arguments, getMixRecipeCatalog().roles);
    if (parsed.status === 'invalid') {
        return failure(parsed.reason);
    }
    const expansion = expandMixRecipe(parsed.input, input.context, input.ordinal);
    if (expansion.status === 'refused') {
        return failure(expansion.reason);
    }
    const retained: RetainedCompilation = {
        kind: 'recipe',
        callId,
        revision,
        commands: expansion.commands,
        recipe: expansion.recipe,
    };
    return {
        commands: expansion.commands,
        recipe: expansion.recipe,
        receipt: {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: RECIPE_EXPANSION_TOOL_NAME,
            turn,
            status: 'success',
            revision,
            data: {
                schema: 'sourdaw.recipe-expansion',
                schemaVersion: 1,
                catalogVersion: expansion.catalogVersion,
                recipeId: expansion.recipe.recipeId,
                title: expansion.recipe.title,
                targetId: expansion.recipe.targetId,
                commands: materializeTransformToolCalls([retained]),
                values: expansion.values,
            },
            summary: `Expanded recipe ${expansion.recipe.recipeId} into ${String(expansion.commands.length)} ordinary command(s).`,
            warnings: [],
            error: null,
        },
    };
}
