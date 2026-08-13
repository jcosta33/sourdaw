import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

export function getExecutableAppActionGroundingCatalog() {
    return getExecutableCommandRegistrations().map((registration) => ({
        actionType: registration.actionType,
        intentPhrases: structuredClone(registration.intentPhrases),
    }));
}
