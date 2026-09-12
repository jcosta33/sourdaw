import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { getCancellationCues } from './getCancellationCues';
import { getNearestIntentAction } from './getNearestIntentAction';
import { getReferencedCancellationAction } from './getReferencedCancellationAction';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

export function hasTrailingIntentCancellation(
    text: string,
    actionName: string,
    catalog: GroundingCatalog,
    plannedActionNames: readonly string[]
): boolean {
    const searchableText = text.toLocaleLowerCase();
    return getCancellationCues(searchableText).some((cue) => {
        const referencedAction = getReferencedCancellationAction(cue, catalog);
        const cancelledAction =
            referencedAction ?? getNearestIntentAction(searchableText, catalog, cue.index, plannedActionNames);
        return cancelledAction === actionName;
    });
}
