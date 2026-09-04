import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

export function getExecutableAppActionGroundingCatalog() {
    return getExecutableCommandRegistrations()
        .filter((registration) => registration.discoverability === 'visible')
        .map((registration) => ({
            actionType: registration.actionType,
            intentPhrases: structuredClone(registration.intentPhrases),
        }));
}
