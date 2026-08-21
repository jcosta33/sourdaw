/* SPDX-FileCopyrightText: 2026 Jose Costa */
/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Tool definitions for the Hermes function calling system prompt.
 * Each tool maps 1:1 to an AppAction type.
 *
 * These are serialized as JSON inside `<tools>` XML in the system prompt —
 * NOT passed via the OpenAI `tools` API parameter.
 *
 * Domain-specific arrays live in ./Tools/*.ts.
 */

import { clipTools, deviceTools } from './Tools/ClipAndDevice';
import { generationTools, markerTools, timeTools, workspaceTools } from './Tools/GenerationAndView';
import { midiTools, automationTools, routingTools } from './Tools/MidiAutomationRouting';
import { trackTools } from './Tools/Track';
import { transportTools } from './Tools/Transport';

export type { ToolSchema } from './Tools/Types';

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
