/**
 * Transformer: tool-call parsing contracts.
 *
 * Strict all-or-nothing planning parsing lives in ./strictToolPlanningParser
 * (ADR 0019); this module is the stable import path for its contracts.
 */

export { parseToolPlanningOutcome, type ToolCallResult, type ToolPlanningOutcome } from './strictToolPlanningParser';
