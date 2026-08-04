import {
    executableAppActionDescriptorByType,
    type ExecutableAppActionDirectionalIntent,
    type ExecutableAppActionTargetRule,
    type ExecutableAppActionValueRule,
} from './executableAppActionRegistry';

type ExecutableAppActionGroundingRules = {
    actionType: string;
    intentPhrases: readonly string[];
    directionalIntent?: ExecutableAppActionDirectionalIntent;
    targetRules: readonly ExecutableAppActionTargetRule[];
    valueRules: readonly ExecutableAppActionValueRule[];
};

export function getExecutableAppActionGroundingRules(actionType: string): ExecutableAppActionGroundingRules | null {
    const descriptor = executableAppActionDescriptorByType.get(actionType);
    if (!descriptor) {
        return null;
    }
    const groundingRules: ExecutableAppActionGroundingRules = {
        actionType: descriptor.actionType,
        intentPhrases: descriptor.intentPhrases,
        targetRules: descriptor.targetRules,
        valueRules: 'valueRules' in descriptor ? descriptor.valueRules : [],
    };
    if ('directionalIntent' in descriptor) {
        groundingRules.directionalIntent = descriptor.directionalIntent;
    }
    return structuredClone(groundingRules);
}
