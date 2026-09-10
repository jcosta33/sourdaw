import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { normalizePromptText } from './normalizePromptText';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

export function isExplicitCommandClause(maskedText: string, catalog: GroundingCatalog): boolean {
    let commandSource = maskedText.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    if (/^["'“”‘’]/u.test(commandSource)) {
        return false;
    }
    const commandText = normalizePromptText(commandSource);
    if (commandText.startsWith('make ')) {
        return true;
    }
    return catalog.some((entry) =>
        entry.intentPhrases.some((phrase) => {
            const normalizedPhrase = normalizePromptText(phrase);
            if (commandText === normalizedPhrase) {
                return true;
            }
            if (!commandText.startsWith(`${normalizedPhrase} `)) {
                return false;
            }
            const suffix = commandText.slice(normalizedPhrase.length).trim();
            return !/^(?:is|means|seems|sounds|was|were)\b/u.test(suffix);
        })
    );
}
