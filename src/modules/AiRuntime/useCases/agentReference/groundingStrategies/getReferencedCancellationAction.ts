import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type CancellationCue } from './getCancellationCues';
import { getIntentPhraseIndex } from './getIntentPhraseIndex';
import { isGenericDeviceIntent } from './isGenericDeviceIntent';
import { normalizePromptText } from './normalizePromptText';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

export function getReferencedCancellationAction(cue: CancellationCue, catalog: GroundingCatalog): string | null {
    const matches = catalog
        .flatMap((entry) =>
            entry.intentPhrases
                .filter((phrase) => !isGenericDeviceIntent(phrase) && getIntentPhraseIndex(cue.text, phrase) >= 0)
                .map((phrase) => ({ actionType: entry.actionType, phrase }))
        )
        .sort((left, right) => normalizePromptText(right.phrase).length - normalizePromptText(left.phrase).length);
    const first = matches[0];
    const second = matches[1];
    if (!first) {
        return null;
    }
    if (
        second &&
        normalizePromptText(second.phrase).length === normalizePromptText(first.phrase).length &&
        second.actionType !== first.actionType
    ) {
        return null;
    }
    return first.actionType;
}
