import {
    isExecutableAppActionType,
    type ExecutableAppActionDirectionalIntent,
    type ExecutableAppActionTargetRule,
    type ExecutableAppActionValueRule,
} from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

type ExecutableAppActionGroundingRules = {
    actionType: string;
    intentPhrases: readonly string[];
    directionalIntent?: ExecutableAppActionDirectionalIntent;
    targetRules: readonly ExecutableAppActionTargetRule[];
    valueRules: readonly ExecutableAppActionValueRule[];
};

export function getExecutableAppActionGroundingRules(actionType: string): ExecutableAppActionGroundingRules | null {
    if (!isExecutableAppActionType(actionType)) {
        return null;
    }
    const registration = getExecutableCommandRegistration(actionType);
    const groundingRules: ExecutableAppActionGroundingRules = {
        actionType: registration.actionType,
        intentPhrases: registration.intentPhrases,
        targetRules: registration.targetChecks,
        valueRules: registration.valueRules,
    };
    if (registration.directionalIntent) {
        groundingRules.directionalIntent = registration.directionalIntent;
    }
    return structuredClone(groundingRules);
}
