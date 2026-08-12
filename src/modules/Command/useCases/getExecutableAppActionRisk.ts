import { executableAppActionDescriptorByType } from './executableAppActionRegistry';

export function getExecutableAppActionRisk(actionType: string) {
    return executableAppActionDescriptorByType.get(actionType)?.risk ?? null;
}
