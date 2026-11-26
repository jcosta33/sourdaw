import { type HostedToolChoiceDirective } from '../repositories/cloudLlm/cloudInference/hostedToolPlan';
import { type ToolCallResult } from '../transformers/toolCallParser';

export function toolChoiceRefusal(
    calls: readonly ToolCallResult[],
    directive: HostedToolChoiceDirective,
    finalTurn: boolean
): string | null {
    if (directive.mode === 'required' && calls.length === 0) {
        if (finalTurn) {
            return 'Provider returned no tool call on the final application tool-loop turn.';
        }
        return 'Provider returned no tool call on a required application tool-loop step.';
    }
    if (directive.parallelToolCalls === false && calls.length > 1) {
        return 'Provider returned multiple tool calls on a single-call application tool-loop step.';
    }
    if (directive.mode === 'required' && calls.some((call) => !directive.toolNames.includes(call.name))) {
        return 'Provider returned a tool outside the required application tool-loop set.';
    }
    return null;
}
