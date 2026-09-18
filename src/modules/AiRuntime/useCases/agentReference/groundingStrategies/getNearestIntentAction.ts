import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { getPromptClauses } from './getPromptClauses';
import { resolveClauseActionIntent } from './resolveClauseActionIntent';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

export function getNearestIntentAction(
    text: string,
    catalog: GroundingCatalog,
    beforeIndex: number,
    plannedActionNames: readonly string[]
): string | null {
    const prefix = text.slice(0, beforeIndex);
    const plannedCatalog = catalog.filter((entry) => plannedActionNames.includes(entry.actionType));
    let actionType: string | null = null;
    for (const clause of getPromptClauses(prefix, prefix)) {
        const intent = resolveClauseActionIntent(clause.masked, plannedCatalog);
        if (intent) {
            actionType = intent.actionType;
        }
    }
    return actionType;
}
