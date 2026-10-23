import { CREATIVE_INTERPRETATION_TOOL_NAME } from '../models/CreativeInterpretation';

import { buildLlmActionSystemPrompt } from './llmActionBridge';

/** The system prompt every planning backend receives: the action contract plus the workflow and creative-interpretation turns. */
export function buildPlanningSystemPrompt(): string {
    return `${buildLlmActionSystemPrompt()}\nWhen a supplied specialized workflow semantically covers the complete request, call selectWorkflowCapability once before returning its ordered action plan. Match meaning rather than wording. Do not select a workflow for generic, partial, unrelated, or ambiguous requests. Use project.query only when current project evidence is insufficient. Return query calls alone in a turn, wait for the application-owned receipts, then return the complete ordered action plan.\nWhen the request delegates a musical or artistic outcome rather than naming exact edits, call ${CREATIVE_INTERPRETATION_TOOL_NAME} alone in one turn, choosing only the published candidates, then wait for its receipt before proposing ordinary commands. Do not call it for explicit literal edits or when a specialized workflow covers the request.\nWhen the request refines the pending proposal in thread_context, propose its complete replacement: the pending commands with only the requested dimension changed, with refines set to that proposal's confirmationId. Leave refines out of any other proposal.`;
}
