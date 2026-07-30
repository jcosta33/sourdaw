import { executableAppActionDescriptors } from './executableAppActionRegistry';

export function getExecutableAppActionGroundingCatalog() {
    return executableAppActionDescriptors.map((descriptor) => ({
        actionType: descriptor.actionType,
        intentPhrases: structuredClone(descriptor.intentPhrases),
    }));
}
