import { executableAppActionDescriptorByType, type ExecutableAppActionTargetRule } from './executableAppActionRegistry';

export function getExecutableAppActionTargetRules(actionType: string): readonly ExecutableAppActionTargetRule[] | null {
    const descriptor = executableAppActionDescriptorByType.get(actionType);
    if (!descriptor) {
        return null;
    }
    return structuredClone(descriptor.targetRules);
}
