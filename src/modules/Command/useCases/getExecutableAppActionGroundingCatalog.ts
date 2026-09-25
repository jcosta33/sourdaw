import { type ExecutableAppActionType, type ExecutableAppActionValueRule } from './executableAppActionRegistry';
import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

type DecibelLevelForm = 'absolute-decibel' | 'relative-decibel';

type ExecutableAppActionGroundingCatalogEntry = {
    actionType: ExecutableAppActionType;
    decibelLevelForms?: DecibelLevelForm[];
    intentPhrases: string[];
    levelIntentPhrases?: string[];
};

function getDecibelLevelForms(valueRules: readonly ExecutableAppActionValueRule[]): DecibelLevelForm[] {
    const forms: DecibelLevelForm[] = [];
    for (const valueRule of valueRules) {
        if (valueRule.kind !== 'number-if-present') {
            continue;
        }
        if (valueRule.levelForm === 'absolute-decibel' || valueRule.levelForm === 'relative-decibel') {
            forms.push(valueRule.levelForm);
        }
    }
    return forms;
}

/**
 * The intent vocabulary of every visible command. An action whose level arguments declare a decibel
 * form also carries those forms, with the phrases that name it only beside such a figure.
 */
export function getExecutableAppActionGroundingCatalog() {
    return getExecutableCommandRegistrations()
        .filter((registration) => registration.discoverability === 'visible')
        .map((registration) => {
            const entry: ExecutableAppActionGroundingCatalogEntry = {
                actionType: registration.actionType,
                intentPhrases: [...registration.intentPhrases],
            };
            const decibelLevelForms = getDecibelLevelForms(registration.valueRules);
            if (decibelLevelForms.length > 0) {
                entry.decibelLevelForms = decibelLevelForms;
                entry.levelIntentPhrases = [...registration.levelIntentPhrases];
            }
            return entry;
        });
}
