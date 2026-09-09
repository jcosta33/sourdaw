import { type RuntimeAction } from '../../models/RuntimeAction';
import { type LlmActionRejection } from '../llmActionBridgeContracts';

import { clipEditingStrategyDefinitions } from './clipEditingStrategies';
import { clipPlacementStrategyDefinitions } from './clipPlacementStrategies';
import { clipActionNames, type ClipCallName, type ClipStrategyInput } from './clipStrategyTypes';
import { createLlmActionStrategyRegistry } from './createLlmActionStrategyRegistry';

export { clipActionNames, type ClipCallName };

const clipStrategyDefinitions = [...clipPlacementStrategyDefinitions, ...clipEditingStrategyDefinitions];

export const clipStrategyRegistry = createLlmActionStrategyRegistry<
    ClipCallName,
    ClipStrategyInput,
    RuntimeAction | LlmActionRejection
>(clipStrategyDefinitions, clipActionNames);

function isClipCallName(value: string): value is ClipCallName {
    return clipActionNames.some((actionName) => actionName === value);
}

export function bridgeClipToolCall(input: ClipStrategyInput): RuntimeAction | LlmActionRejection | null {
    if (!isClipCallName(input.call.name)) {
        return null;
    }
    const strategy = clipStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
