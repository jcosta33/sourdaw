import {
    ANALYSIS_MEASURE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    PROJECT_QUERY_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../models/AgentToolCatalogNames';
import { CREATIVE_INTERPRETATION_TOOL_NAME } from '../models/CreativeInterpretation';

import { buildLlmActionSystemPrompt } from './llmActionBridge';

const MIXING_METHOD = `When the request asks for a mix outcome without naming values, such as warmer or less muddy, work in this order: (1) resolve the target from the project context; (2) measure it with ${ANALYSIS_MEASURE_TOOL_NAME}; (3) discover a recipe with ${RECIPE_DISCOVERY_TOOL_NAME} and expand it with ${RECIPE_EXPANSION_TOOL_NAME}; (4) plan values inside the recipe's ranges; (5) measure that planned list as a preview with ${ANALYSIS_MEASURE_TOOL_NAME} subject 'preview' and the list as proposal; (6) propose with ${COMMAND_BATCH_PROPOSAL_TOOL_NAME}, adopting only the preview's callId in compiledCallIds, because its list already carries the recipe's commands. Reads that need no earlier receipt share one turn, such as ${ANALYSIS_MEASURE_TOOL_NAME} on the target beside ${RECIPE_DISCOVERY_TOOL_NAME}; ${RECIPE_EXPANSION_TOOL_NAME}, the preview and the propose each wait for the receipt before them. ${COMMAND_BATCH_PROPOSAL_TOOL_NAME} ends the run, so measure before it. With no preview, adopt ${RECIPE_EXPANSION_TOOL_NAME}'s or ${TRANSFORM_COMPILE_TOOL_NAME}'s callId instead. If the project context cannot resolve the target, call ${PROJECT_QUERY_TOOL_NAME} alone first; the preview would then need a turn the run does not have, so skip (2) and (5) and propose adopting ${RECIPE_EXPANSION_TOOL_NAME}'s callId. Recipes and their ranges come only from the catalog, never invented. Explicit literal edits skip measurement.
A level takes exactly one of its linear field (gain, level, value), its absolute decibel field (gainDb, levelDb, valueDb) or relative deltaDb. To apply one command to a set, give the list item a selector with targetArgument, entity, where or match, excludeIds and a quantity of exactly or maximum with unit 'targets'.`;

/** The system prompt every planning backend receives: the action contract plus the workflow, mixing-method and creative-interpretation turns. */
export function buildPlanningSystemPrompt(): string {
    return `${buildLlmActionSystemPrompt()}\nWhen a supplied specialized workflow semantically covers the complete request, call selectWorkflowCapability once before returning its ordered action plan. Match meaning rather than wording. Do not select a workflow for generic, partial, unrelated, or ambiguous requests. Use ${PROJECT_QUERY_TOOL_NAME} only when current project evidence is insufficient. Return query calls alone in a turn, wait for the application-owned receipts, then return the complete ordered action plan.\n${MIXING_METHOD}\nWhen the request delegates a musical or artistic outcome rather than naming exact edits, call ${CREATIVE_INTERPRETATION_TOOL_NAME} alone in the first turn, before any other tool, choosing only the published candidates, then wait for its receipt before proposing ordinary commands. Do not call it for explicit literal edits or when a specialized workflow covers the request.\nWhen the request refines the pending proposal in thread_context, propose its complete replacement: the pending commands with only the requested dimension changed, with refines set to that proposal's confirmationId. Leave refines out of any other proposal.`;
}
