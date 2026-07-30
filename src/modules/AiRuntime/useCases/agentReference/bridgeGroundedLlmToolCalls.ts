import { getExecutableAppActionTargetRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeLlmToolCalls, type LlmActionRejection } from '../../transformers/llmActionBridge';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../../transformers/llmActionLimits';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { resolveAgentReference } from './resolveAgentReference';

type BridgeGroundedLlmToolCallsInput = {
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    prompt: string;
};

type GroundToolCallInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
    prompt: string;
};

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}

function groundToolCall({ call, context, index, prompt }: GroundToolCallInput): ToolCallResult | LlmActionRejection {
    const targetRules = getExecutableAppActionTargetRules(call.name);
    if (!targetRules) {
        return call;
    }

    const groundedArguments = { ...call.arguments };
    for (const targetRule of targetRules) {
        const assertedValue = groundedArguments[targetRule.argument];
        const dependencyValue = targetRule.dependsOn ? groundedArguments[targetRule.dependsOn] : undefined;
        const distinctValue = targetRule.distinctFrom ? groundedArguments[targetRule.distinctFrom] : undefined;
        if (targetRule.distinctFrom && typeof distinctValue === 'string' && assertedValue === distinctValue) {
            return rejection(
                index,
                call.name,
                `Target ${targetRule.argument} must be distinct from ${targetRule.distinctFrom}`
            );
        }
        const result = resolveAgentReference({
            prompt,
            assertedId: assertedValue,
            capability: targetRule.capability,
            context,
            dependencyId: typeof dependencyValue === 'string' ? dependencyValue : undefined,
            excludedIds: typeof distinctValue === 'string' ? [distinctValue] : [],
        });
        if (result.status === 'rejected') {
            if (result.reason === 'ambiguous-target') {
                return rejection(index, call.name, `Target ${targetRule.argument} is ambiguous in the user request`);
            }
            if (result.reason === 'asserted-target-mismatch') {
                return rejection(
                    index,
                    call.name,
                    `Provider target ${targetRule.argument} does not match the uniquely grounded project reference`
                );
            }
            return rejection(index, call.name, `Target ${targetRule.argument} is not grounded in the user request`);
        }

        groundedArguments[targetRule.argument] = result.id;
    }

    return { ...call, arguments: groundedArguments };
}

export function bridgeGroundedLlmToolCalls({ calls, context, prompt }: BridgeGroundedLlmToolCallsInput) {
    if (calls.length > MAX_LLM_ACTIONS_PER_BATCH) {
        return bridgeLlmToolCalls({ calls, context });
    }
    const groundingRejections = new Map<number, LlmActionRejection>();
    const groundedCalls = calls.map((call, index) => {
        const grounded = groundToolCall({ call, context, index, prompt });
        if ('reason' in grounded) {
            groundingRejections.set(index, grounded);
            return { name: '<rejected-target-reference>', arguments: {} };
        }
        return grounded;
    });
    const bridged = bridgeLlmToolCalls({ calls: groundedCalls, context });
    return {
        actions: bridged.actions,
        rejections: bridged.rejections.map((bridgeRejection) => {
            if (bridgeRejection.name === '<batch>') {
                return bridgeRejection;
            }
            return groundingRejections.get(bridgeRejection.index) ?? bridgeRejection;
        }),
    };
}
