import {
    executableAppActionDescriptorByType,
    type ExecutableAppActionTargetRule,
    type ExecutableAppActionValueRule,
} from './executableAppActionRegistry';

type ExecutableAppActionGroundingRules = {
    actionType: string;
    intentPhrases: readonly string[];
    targetRules: readonly ExecutableAppActionTargetRule[];
    valueRules: readonly ExecutableAppActionValueRule[];
};

export function getExecutableAppActionGroundingRules(actionType: string): ExecutableAppActionGroundingRules | null {
    const descriptor = executableAppActionDescriptorByType.get(actionType);
    if (!descriptor) {
        return null;
    }
    return structuredClone({
        actionType: descriptor.actionType,
        intentPhrases: descriptor.intentPhrases,
        targetRules: descriptor.targetRules,
        valueRules: 'valueRules' in descriptor ? descriptor.valueRules : [],
    });
}
