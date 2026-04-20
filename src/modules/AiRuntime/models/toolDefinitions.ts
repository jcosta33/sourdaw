/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/**
 * Tool definitions for the Hermes function calling system prompt.
 * Each tool maps 1:1 to an AppAction type.
 *
 * These are serialized as JSON inside `<tools>` XML in the system prompt —
 * NOT passed via the OpenAI `tools` API parameter.
 *
 * Domain-specific arrays live in ./tools/*.ts.
 */

import { clipTools, deviceTools } from './tools/clipAndDevice';
import { generationTools, markerTools, timeTools, workspaceTools } from './tools/generationAndView';
import { midiTools, automationTools, routingTools } from './tools/midiAutomationRouting';
import { trackTools } from './tools/track';
import { transportTools } from './tools/transport';

export type { ToolSchema } from './tools/types';

/** All tool schemas exposed to the LLM via the system prompt. */
export const DAW_TOOL_SCHEMAS = [
    ...trackTools,
    ...transportTools,
    ...clipTools,
    ...deviceTools,
    ...midiTools,
    ...automationTools,
    ...routingTools,
    ...generationTools,
    ...markerTools,
    ...timeTools,
    ...workspaceTools,
];
